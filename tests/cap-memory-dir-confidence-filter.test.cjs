// @cap-feature(feature:F-090) Confidence-Filter for V5 Memory Output — unit + integration tests
// @cap-context Verifies that low-confidence heuristic-extracted entries are dropped from .md output
//   while pinned and high-confidence entries survive. Hotspot category is unfiltered (different shape).

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = require('../cap/bin/lib/cap-memory-dir.cjs');

function entry(opts) {
  return {
    category: opts.category || 'decision',
    content: opts.content || 'sample content',
    metadata: {
      confidence: opts.confidence,
      evidence_count: opts.evidence_count || 1,
      pinned: opts.pinned === true,
      last_seen: opts.last_seen || '2026-05-08T00:00:00.000Z',
      source: opts.source || '2026-05-08',
      relatedFiles: opts.relatedFiles || [],
      features: opts.features || [],
    },
    file: opts.file,
  };
}

describe('F-090 _filterEntriesForOutput — pure function', () => {
  it('drops entries below confidence threshold', () => {
    const input = [
      entry({ content: 'low', confidence: 0.5 }),
      entry({ content: 'high', confidence: 0.7 }),
    ];
    const out = dir._filterEntriesForOutput(input, { minConfidence: 0.6 });
    assert.equal(out.length, 1);
    assert.equal(out[0].content, 'high');
  });

  it('keeps pinned entries regardless of confidence', () => {
    const input = [
      entry({ content: 'pinned-low', confidence: 0.0, pinned: true }),
      entry({ content: 'unpinned-low', confidence: 0.0, pinned: false }),
    ];
    const out = dir._filterEntriesForOutput(input, { minConfidence: 0.6 });
    assert.equal(out.length, 1);
    assert.equal(out[0].content, 'pinned-low');
  });

  it('exact-threshold confidence is kept (>= comparison)', () => {
    const input = [entry({ content: 'exact', confidence: 0.6 })];
    const out = dir._filterEntriesForOutput(input, { minConfidence: 0.6 });
    assert.equal(out.length, 1);
  });

  it('handles missing metadata defensively', () => {
    const input = [
      { category: 'decision', content: 'no-metadata' },
      null,
      { category: 'decision', content: 'metadata-empty', metadata: {} },
    ];
    // Should not throw; entries without confidence / metadata get filtered out
    const out = dir._filterEntriesForOutput(input, { minConfidence: 0.6 });
    // ensureFields() defaults confidence to 0.5; below 0.6 → filtered out
    assert.equal(out.length, 0);
  });

  it('respects custom threshold via options', () => {
    const input = [
      entry({ content: 'a', confidence: 0.5 }),
      entry({ content: 'b', confidence: 0.8 }),
    ];
    const lenient = dir._filterEntriesForOutput(input, { minConfidence: 0.4 });
    assert.equal(lenient.length, 2);
    const strict = dir._filterEntriesForOutput(input, { minConfidence: 0.9 });
    assert.equal(strict.length, 0);
  });
});

describe('F-090 generateCategoryMarkdown — filter integrated (explicit threshold)', () => {
  it('drops low-confidence decisions when threshold given', () => {
    const entries = [
      entry({ content: 'low-confidence one-shot', confidence: 0.5 }),
      entry({ content: 'high-confidence multi-evidence', confidence: 0.8 }),
    ];
    const md = dir.generateCategoryMarkdown('decision', entries, { minConfidence: 0.6 });
    assert.match(md, /high-confidence multi-evidence/);
    assert.doesNotMatch(md, /low-confidence one-shot/);
  });

  it('default (no opts) renders ALL entries — separation-of-concerns: rendering vs filtering', () => {
    const entries = [
      entry({ content: 'auto-low', confidence: 0.5 }),
      entry({ content: 'auto-high', confidence: 0.8 }),
    ];
    const md = dir.generateCategoryMarkdown('decision', entries);
    assert.match(md, /auto-low/);
    assert.match(md, /auto-high/);
    assert.match(md, /\*2 decisions total\*/);
  });

  it('footer counter shows kept + dropped counts when any are filtered', () => {
    const entries = [
      entry({ content: 'a', confidence: 0.5 }),
      entry({ content: 'b', confidence: 0.5 }),
      entry({ content: 'c', confidence: 0.8 }),
    ];
    const md = dir.generateCategoryMarkdown('decision', entries, { minConfidence: 0.6 });
    assert.match(md, /1 decisions kept \(filtered out 2 low-confidence decisions/);
  });

  it('footer counter shows total when nothing filtered', () => {
    const entries = [
      entry({ content: 'a', confidence: 0.7 }),
      entry({ content: 'b', confidence: 0.8 }),
    ];
    const md = dir.generateCategoryMarkdown('decision', entries, { minConfidence: 0.6 });
    assert.match(md, /\*2 decisions total\*/);
  });

  it('all-filtered case emits placeholder with drop count', () => {
    const entries = [
      entry({ content: 'a', confidence: 0.5 }),
      entry({ content: 'b', confidence: 0.5 }),
    ];
    const md = dir.generateCategoryMarkdown('decision', entries, { minConfidence: 0.6 });
    assert.match(md, /No high-confidence decisions recorded yet \(filtered out 2/);
  });

  it('hotspot category is NOT filtered (different format, regenerated each run)', () => {
    const entries = [
      {
        category: 'hotspot',
        content: 'low-conf hotspot',
        file: 'src/foo.ts',
        metadata: { sessions: 5, edits: 30, since: '2026-05-01', confidence: 0.0 },
      },
    ];
    const md = dir.generateCategoryMarkdown('hotspot', entries, { minConfidence: 0.9 });
    // Hotspot rendered as ranking table — confidence not consulted
    assert.match(md, /src\/foo\.ts/);
    assert.match(md, /\| 5 \|/);
  });

  it('custom minConfidence option is honored', () => {
    const entries = [
      entry({ content: 'a', confidence: 0.5 }),
      entry({ content: 'b', confidence: 0.55 }),
    ];
    // Lenient threshold lets both through
    const md = dir.generateCategoryMarkdown('decision', entries, { minConfidence: 0.5 });
    assert.match(md, /a/);
    assert.match(md, /b/);
    assert.match(md, /\*2 decisions total\*/);
  });

  it('pinned entries survive even with confidence:0.0 when filter active', () => {
    const entries = [
      entry({ content: 'user-curated', confidence: 0.0, pinned: true }),
      entry({ content: 'auto-low', confidence: 0.5 }),
    ];
    const md = dir.generateCategoryMarkdown('decision', entries, { minConfidence: 0.6 });
    assert.match(md, /user-curated/);
    assert.match(md, /\*\*\[pinned\]\*\*/);
    assert.doesNotMatch(md, /auto-low/);
  });
});

describe('F-090 writeMemoryDirectory — end-to-end with explicit threshold (hook policy)', () => {
  // The HOOK (hooks/cap-memory.js) is what passes minConfidence:0.6 in production.
  // Direct callers don't get the filter by default — preserves backwards-compat for tests.

  it('written decisions.md only contains entries above threshold when minConfidence given', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-f090-'));
    try {
      const entries = [
        entry({ category: 'decision', content: 'kept', confidence: 0.7 }),
        entry({ category: 'decision', content: 'dropped', confidence: 0.5 }),
        entry({ category: 'decision', content: 'pinned-zero', confidence: 0.0, pinned: true }),
      ];
      dir.writeMemoryDirectory(tmp, entries, { minConfidence: 0.6 });
      const decisions = fs.readFileSync(path.join(tmp, '.cap', 'memory', 'decisions.md'), 'utf8');
      assert.match(decisions, /kept/);
      assert.match(decisions, /pinned-zero/);
      assert.doesNotMatch(decisions, /dropped/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('size reduction: 100 low-conf + 5 high-conf entries → output covers only the 5', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-f090-'));
    try {
      const entries = [];
      for (let i = 0; i < 100; i++) {
        entries.push(entry({ category: 'decision', content: 'noise-' + i, confidence: 0.5 }));
      }
      for (let i = 0; i < 5; i++) {
        entries.push(entry({ category: 'decision', content: 'signal-' + i, confidence: 0.8 }));
      }
      dir.writeMemoryDirectory(tmp, entries, { minConfidence: 0.6 });
      const decisions = fs.readFileSync(path.join(tmp, '.cap', 'memory', 'decisions.md'), 'utf8');
      // All 5 signal entries should appear; no noise entries should appear
      for (let i = 0; i < 5; i++) assert.match(decisions, new RegExp('signal-' + i));
      for (let i = 0; i < 100; i++) assert.doesNotMatch(decisions, new RegExp('\\bnoise-' + i + '\\b'));
      assert.match(decisions, /5 decisions kept \(filtered out 100/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('without minConfidence option: all entries written (backwards-compat)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-f090-'));
    try {
      const entries = [
        entry({ category: 'decision', content: 'low', confidence: 0.3 }),
        entry({ category: 'decision', content: 'high', confidence: 0.9 }),
      ];
      dir.writeMemoryDirectory(tmp, entries);
      const decisions = fs.readFileSync(path.join(tmp, '.cap', 'memory', 'decisions.md'), 'utf8');
      assert.match(decisions, /low/);
      assert.match(decisions, /high/);
      assert.match(decisions, /\*2 decisions total\*/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
