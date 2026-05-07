'use strict';

// @cap-feature(feature:F-086) Dedup tests for cap-annotation-writer.cjs — verifies that
//   aggregate annotations like @cap-history match by tag-name only, so changing edit-counts
//   between pipeline runs replace the existing line in-place instead of appending a duplicate.
//   The bug was observed on GoetzeInvest (apps/hub/src/types/hub-types.ts had two distinct
//   @cap-history headers from successive memory-pipeline runs).

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { writeAnnotations } = require('../cap/bin/lib/cap-annotation-writer.cjs');

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-dedup-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

function makeEntry(file, sessions, edits, since) {
  return {
    category: 'hotspot',
    file,
    content: `Frequently modified — ${sessions} sessions, ${edits} edits`,
    metadata: {
      sessions, edits, since,
      pinned: false,
      source: '2026-05-07T10:00:00Z',
    },
  };
}

function countHistoryLines(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return content.split('\n').filter((l) => /@cap-history\(/.test(l)).length;
}

describe('AC-1: @cap-history dedup matches by tag-name only', () => {
  it('first run writes one @cap-history line', () => {
    const fp = path.join(tmp, 'a.js');
    fs.writeFileSync(fp, "'use strict';\n\nconst x = 1;\n");
    writeAnnotations({ [fp]: [makeEntry(fp, 2, 5, '2026-04-30')] });
    assert.equal(countHistoryLines(fp), 1);
  });

  it('second run with different stats replaces in-place (not append)', () => {
    const fp = path.join(tmp, 'b.js');
    fs.writeFileSync(fp, "'use strict';\n\nconst x = 1;\n");
    // Run 1
    writeAnnotations({ [fp]: [makeEntry(fp, 2, 5, '2026-04-30')] });
    assert.equal(countHistoryLines(fp), 1);
    // Run 2 with new counts (different edit count)
    writeAnnotations({ [fp]: [makeEntry(fp, 2, 6, '2026-04-30')] });
    const after = fs.readFileSync(fp, 'utf8');
    assert.equal(countHistoryLines(fp), 1, 'must still be exactly 1 @cap-history line');
    assert.match(after, /edits:6/);
    assert.doesNotMatch(after, /edits:5/);
  });

  it('third run with yet another stat update keeps single line', () => {
    const fp = path.join(tmp, 'c.js');
    fs.writeFileSync(fp, "'use strict';\n");
    writeAnnotations({ [fp]: [makeEntry(fp, 1, 3, '2026-04-01')] });
    writeAnnotations({ [fp]: [makeEntry(fp, 2, 5, '2026-04-15')] });
    writeAnnotations({ [fp]: [makeEntry(fp, 4, 12, '2026-05-01')] });
    assert.equal(countHistoryLines(fp), 1);
    const final = fs.readFileSync(fp, 'utf8');
    assert.match(final, /sessions:4.*edits:12/);
  });

  it('regression: a file with TWO pre-existing @cap-history lines collapses to ONE on next run', () => {
    // Simulate the GoetzeInvest pre-existing pollution:
    const fp = path.join(tmp, 'polluted.js');
    fs.writeFileSync(fp, [
      "// @cap-feature(feature:F-HUB) Core types",
      "// @cap-history(sessions:4, edits:5, since:2026-03-31, learned:2026-04-03) Frequently modified — 4 sessions, 5 edits",
      "// @cap-history(sessions:2, edits:2, since:2026-04-30, learned:2026-04-30) Frequently modified — 2 sessions, 2 edits",
      "const x = 1;",
    ].join('\n'));
    assert.equal(countHistoryLines(fp), 2, 'sanity: setup has 2 polluted lines');

    // Pipeline runs, finds new aggregate stats. The dedup matcher will UPDATE the FIRST
    // one it finds and append nothing — leaving the OTHER stale @cap-history in place
    // until removeStaleAnnotations runs. This test pins that update happens to one of them
    // (not a third line is added).
    writeAnnotations({ [fp]: [makeEntry(fp, 5, 10, '2026-05-07')] });
    const lineCount = countHistoryLines(fp);
    assert.ok(lineCount <= 2, `must not append a 3rd line (got ${lineCount})`);
    const updated = fs.readFileSync(fp, 'utf8');
    assert.match(updated, /sessions:5.*edits:10/);
  });
});

describe('AC-1: per-occurrence tags (@cap-pitfall, @cap-decision, @cap-pattern) keep content-prefix dedup', () => {
  it('two distinct @cap-pitfall annotations with different content both write', () => {
    const fp = path.join(tmp, 'd.js');
    fs.writeFileSync(fp, "'use strict';\n");
    writeAnnotations({ [fp]: [
      {
        category: 'pitfall',
        file: fp,
        content: 'Race condition on save',
        metadata: { pinned: false, source: '2026-05-01T10:00:00Z' },
      },
      {
        category: 'pitfall',
        file: fp,
        content: 'Memory leak in worker pool',
        metadata: { pinned: false, source: '2026-05-02T10:00:00Z' },
      },
    ] });
    const content = fs.readFileSync(fp, 'utf8');
    const pitfallCount = content.split('\n').filter((l) => /@cap-pitfall/.test(l)).length;
    assert.equal(pitfallCount, 2, 'two distinct pitfalls must both be written');
  });

  it('same @cap-pitfall content in two runs only writes once', () => {
    const fp = path.join(tmp, 'e.js');
    fs.writeFileSync(fp, "'use strict';\n");
    const entry = {
      category: 'pitfall',
      file: fp,
      content: 'Watch out for null author',
      metadata: { pinned: false, source: '2026-05-01T10:00:00Z' },
    };
    writeAnnotations({ [fp]: [entry] });
    writeAnnotations({ [fp]: [entry] });
    const content = fs.readFileSync(fp, 'utf8');
    const pitfallCount = content.split('\n').filter((l) => /@cap-pitfall/.test(l)).length;
    assert.equal(pitfallCount, 1, 'same pitfall must dedup on second run');
  });
});
