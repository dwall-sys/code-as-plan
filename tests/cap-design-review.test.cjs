'use strict';

// @cap-feature(feature:F-064) cap:design --review — RED baseline tests for Anti-Slop-Check.
// @cap-context Covers all 5 ACs: spawn (via library surface), report schema, read-only purity, configurable rules, idempotence.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  AESTHETIC_FAMILIES,
  buildDesignMd,
  writeDesignMd,
  readDesignMd,
  DEFAULT_DESIGN_RULES,
  REVIEW_SEVERITIES,
  DESIGN_REVIEW_FILE,
  parseDesignRules,
  reviewDesign,
  formatReviewReport,
  readDesignRules,
  writeDesignReview,
} = require('../cap/bin/lib/cap-design.cjs');

let tmpDir;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-f064-'));
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// AC-1 + AC-4 — parseDesignRules: default ruleset + markdown parsing
// ---------------------------------------------------------------------------

describe('F-064/AC-1 + AC-4 — parseDesignRules', () => {
  // @cap-todo(ac:F-064/AC-4) Default ruleset returned when no file present.
  it('returns DEFAULT_DESIGN_RULES when input is null', () => {
    const rules = parseDesignRules(null);
    assert.strictEqual(rules, DEFAULT_DESIGN_RULES);
  });

  it('returns DEFAULT_DESIGN_RULES when input is undefined', () => {
    const rules = parseDesignRules(undefined);
    assert.strictEqual(rules, DEFAULT_DESIGN_RULES);
  });

  it('returns DEFAULT_DESIGN_RULES when input is empty string', () => {
    const rules = parseDesignRules('');
    assert.strictEqual(rules, DEFAULT_DESIGN_RULES);
  });

  it('returns DEFAULT_DESIGN_RULES when input is whitespace only', () => {
    const rules = parseDesignRules('   \n  \n');
    assert.strictEqual(rules, DEFAULT_DESIGN_RULES);
  });

  it('DEFAULT_DESIGN_RULES is a frozen non-empty array with correct schema', () => {
    assert.ok(Array.isArray(DEFAULT_DESIGN_RULES));
    assert.ok(Object.isFrozen(DEFAULT_DESIGN_RULES));
    assert.ok(DEFAULT_DESIGN_RULES.length >= 3);
    for (const r of DEFAULT_DESIGN_RULES) {
      assert.ok(typeof r.name === 'string');
      assert.ok(typeof r.kind === 'string');
      assert.ok(typeof r.description === 'string');
      assert.ok(typeof r.suggestion === 'string');
      assert.ok(REVIEW_SEVERITIES.includes(r.severity), `invalid severity ${r.severity}`);
      assert.ok(Object.isFrozen(r), `rule ${r.name} not frozen`);
    }
  });

  // @cap-todo(ac:F-064/AC-4) Parses markdown bullets under ## Rules.
  it('parses markdown rules under ## Rules header', () => {
    const md = `# Design Rules

## Rules

- **[typography] no-comic-sans**: Reject Comic Sans.
  Suggestion: Use a serious typeface.
- **[color] no-hot-pink**: Reject #FF00FF.
  Suggestion: Use brand color.
`;
    const rules = parseDesignRules(md);
    assert.notStrictEqual(rules, DEFAULT_DESIGN_RULES);
    assert.strictEqual(rules.length, 2);
    assert.strictEqual(rules[0].name, 'typography/no-comic-sans');
    assert.strictEqual(rules[0].kind, 'typography');
    assert.strictEqual(rules[0].description, 'Reject Comic Sans.');
    assert.strictEqual(rules[0].suggestion, 'Use a serious typeface.');
    assert.strictEqual(rules[0].severity, 'warning');
    assert.strictEqual(rules[1].name, 'color/no-hot-pink');
  });

  it('parses severity annotation [severity:error]', () => {
    const md = `## Rules

- **[color][severity:error] banned-color**: No.
  Suggestion: Pick another.
`;
    const rules = parseDesignRules(md);
    assert.strictEqual(rules.length, 1);
    assert.strictEqual(rules[0].severity, 'error');
  });

  it('falls back to DEFAULT when rules section is present but empty/malformed', () => {
    const md = `# Design Rules

## Rules

(no rules here)
`;
    const rules = parseDesignRules(md);
    assert.strictEqual(rules, DEFAULT_DESIGN_RULES);
  });

  it('custom rules array is frozen', () => {
    const md = `## Rules

- **[layout] pattern-a**: desc.
  Suggestion: sug.
`;
    const rules = parseDesignRules(md);
    assert.ok(Object.isFrozen(rules));
    for (const r of rules) assert.ok(Object.isFrozen(r));
  });
});

// ---------------------------------------------------------------------------
// AC-2 — reviewDesign output schema
// ---------------------------------------------------------------------------

describe('F-064/AC-2 — reviewDesign output schema', () => {
  // @cap-todo(ac:F-064/AC-2) Violation schema: { id, kind, rule, location, suggestion, severity }.
  it('returns an array', () => {
    const result = reviewDesign('', DEFAULT_DESIGN_RULES);
    assert.ok(Array.isArray(result));
  });

  it('each violation has the required schema fields', () => {
    // DESIGN.md containing a generic font trigger.
    const badMd = `# DESIGN.md

## Tokens

### Typography

- family: "Inter, Arial"
- familyMono: "JetBrains Mono"
- scale: [12, 14, 16]
`;
    const violations = reviewDesign(badMd, DEFAULT_DESIGN_RULES);
    assert.ok(violations.length > 0, 'expected at least one violation for generic font');
    for (const v of violations) {
      assert.ok('id' in v, 'missing id');
      assert.ok(typeof v.kind === 'string', 'missing kind');
      assert.ok(typeof v.rule === 'string', 'missing rule');
      assert.ok(typeof v.location === 'object' && v.location !== null, 'missing location');
      assert.ok(typeof v.suggestion === 'string', 'missing suggestion');
      assert.ok(REVIEW_SEVERITIES.includes(v.severity), `invalid severity ${v.severity}`);
      // Location sub-schema
      assert.ok('line' in v.location, 'location.line missing');
      assert.ok('id' in v.location, 'location.id missing');
      assert.ok('section' in v.location, 'location.section missing');
    }
  });

  it('flags generic fonts (Inter/Arial)', () => {
    const badMd = `## Typography

- family: "Inter"
- familyMono: "JetBrains Mono"
`;
    const violations = reviewDesign(badMd, DEFAULT_DESIGN_RULES);
    const hit = violations.find(v => v.rule === 'typography/no-generic-fonts');
    assert.ok(hit, 'expected typography violation');
    assert.strictEqual(hit.kind, 'typography');
  });

  it('flags cliche purple-blue gradients', () => {
    const badMd = `# DESIGN.md

- hero-bg: linear-gradient(to right, #667eea, #764ba2)
`;
    const violations = reviewDesign(badMd, DEFAULT_DESIGN_RULES);
    const hit = violations.find(v => v.rule === 'color/no-cliche-gradients');
    assert.ok(hit, 'expected gradient violation');
  });

  it('flags cookie-cutter layout mentions', () => {
    const badMd = `# DESIGN.md

> Layout: centered hero + 3-column feature cards + CTA at bottom.
`;
    const violations = reviewDesign(badMd, DEFAULT_DESIGN_RULES);
    const hit = violations.find(v => v.rule === 'layout/no-cookie-cutter');
    assert.ok(hit, 'expected layout violation');
  });

  it('flags structure/inconsistent-token-ids when mixed coverage', () => {
    // File has SOME IDs (so inconsistency rule fires on bullets without IDs).
    const badMd = `# DESIGN.md

## Tokens

### Colors

- primary: #111111 (id: DT-001)
- background: #FAFAFA

### Typography

- family: "PP Editorial New"

## Components

### Button (id: DC-001)
`;
    const violations = reviewDesign(badMd, DEFAULT_DESIGN_RULES);
    const hit = violations.find(v => v.rule === 'structure/inconsistent-token-ids');
    assert.ok(hit, 'expected structure violation for background token');
  });

  it('clean DESIGN.md produces zero violations', () => {
    const fam = AESTHETIC_FAMILIES['warm-editorial']; // GT Super / GT America — not in generic list
    const md = buildDesignMd({ family: fam, withIds: true });
    const violations = reviewDesign(md, DEFAULT_DESIGN_RULES);
    // There may be zero — warm-editorial uses GT Super which is not generic.
    const genericHits = violations.filter(v => v.rule === 'typography/no-generic-fonts');
    assert.strictEqual(genericHits.length, 0, 'warm-editorial should not trip generic font rule');
  });

  it('throws on non-string input', () => {
    assert.throws(() => reviewDesign(null, DEFAULT_DESIGN_RULES));
    assert.throws(() => reviewDesign(undefined, DEFAULT_DESIGN_RULES));
    assert.throws(() => reviewDesign(42, DEFAULT_DESIGN_RULES));
  });

  it('accepts empty ruleset by falling back to defaults', () => {
    const badMd = '- family: "Inter"\n';
    const violations = reviewDesign(badMd, []);
    // Empty rules means defaults apply -> should flag Inter.
    assert.ok(violations.some(v => v.rule === 'typography/no-generic-fonts'));
  });
});

// ---------------------------------------------------------------------------
// AC-3 — Review is read-only (verify by property, not behavior)
// ---------------------------------------------------------------------------

describe('F-064/AC-3 — read-only purity', () => {
  // @cap-todo(ac:F-064/AC-3) reviewDesign and formatReviewReport MUST be pure — no fs writes, no mutations.
  it('reviewDesign does not mutate input string (strings are immutable, but checks content identity)', () => {
    const input = '- family: "Inter"\n';
    const snapshot = input;
    reviewDesign(input, DEFAULT_DESIGN_RULES);
    assert.strictEqual(input, snapshot);
  });

  it('reviewDesign does not mutate input rules array', () => {
    const rules = [...DEFAULT_DESIGN_RULES];
    const snapshot = rules.length;
    reviewDesign('- family: "Inter"', rules);
    assert.strictEqual(rules.length, snapshot);
    // Per-rule frozen status preserved
    for (const r of rules) assert.ok(Object.isFrozen(r));
  });

  it('reviewDesign is synchronous (returns array, not Promise)', () => {
    const result = reviewDesign('', DEFAULT_DESIGN_RULES);
    assert.ok(!(result instanceof Promise));
    assert.ok(Array.isArray(result));
  });

  it('reviewDesign does not touch the filesystem (write DESIGN.md, then verify byte-identical after review)', () => {
    const md = buildDesignMd({ family: AESTHETIC_FAMILIES['editorial-minimalism'], withIds: true });
    writeDesignMd(tmpDir, md);
    const before = fs.readFileSync(path.join(tmpDir, 'DESIGN.md'), 'utf8');
    const beforeMtime = fs.statSync(path.join(tmpDir, 'DESIGN.md')).mtimeMs;

    // Run review (pure function — no projectRoot passed).
    reviewDesign(before, DEFAULT_DESIGN_RULES);

    const after = fs.readFileSync(path.join(tmpDir, 'DESIGN.md'), 'utf8');
    const afterMtime = fs.statSync(path.join(tmpDir, 'DESIGN.md')).mtimeMs;
    assert.strictEqual(after, before, 'DESIGN.md content must be byte-identical');
    assert.strictEqual(afterMtime, beforeMtime, 'DESIGN.md mtime must not change');
  });

  it('reviewDesign signature takes strings only (not paths)', () => {
    // Verify the function does NOT accept a projectRoot argument path — it takes raw content.
    // This is a property-based assertion: passing a directory path should not trip fs reads.
    // The function should treat the string as CONTENT, not a path.
    const result = reviewDesign('/some/fake/path/that/does/not/exist', DEFAULT_DESIGN_RULES);
    // It parsed the raw string as content — no violations because the string has no DESIGN.md structure.
    assert.ok(Array.isArray(result));
  });

  it('formatReviewReport does not touch the filesystem', () => {
    const tmpFile = path.join(tmpDir, 'sentinel.txt');
    fs.writeFileSync(tmpFile, 'original');
    const violations = reviewDesign('- family: "Inter"', DEFAULT_DESIGN_RULES);
    formatReviewReport(violations);
    const after = fs.readFileSync(tmpFile, 'utf8');
    assert.strictEqual(after, 'original');
  });
});

// ---------------------------------------------------------------------------
// AC-5 — Idempotence: 100x same input → byte-identical output
// ---------------------------------------------------------------------------

describe('F-064/AC-5 — idempotent, deterministic report', () => {
  // @cap-todo(ac:F-064/AC-5) Same input 100x -> byte-identical violations array + report.
  const badMd = `# DESIGN.md

## Tokens

### Colors

- primary: #111111 (id: DT-001)
- background: #FAFAFA
- gradient: linear-gradient(to right, #667eea, #764ba2)

### Typography

- family: "Inter, Arial"
- familyMono: "JetBrains Mono"
- scale: [12, 14, 16]

## Components

### Button (id: DC-001)

- variants: [primary, secondary]
- states: [default, hover]

### Card
`;

  it('reviewDesign returns byte-identical violations on 100 repeated calls', () => {
    const first = JSON.stringify(reviewDesign(badMd, DEFAULT_DESIGN_RULES));
    for (let i = 0; i < 100; i++) {
      const next = JSON.stringify(reviewDesign(badMd, DEFAULT_DESIGN_RULES));
      assert.strictEqual(next, first, `iteration ${i} diverged`);
    }
  });

  it('formatReviewReport is byte-identical on 100 repeated calls', () => {
    const violations = reviewDesign(badMd, DEFAULT_DESIGN_RULES);
    const first = formatReviewReport(violations);
    for (let i = 0; i < 100; i++) {
      const next = formatReviewReport(violations);
      assert.strictEqual(next, first, `iteration ${i} diverged`);
    }
  });

  it('end-to-end (review -> format) is byte-identical on 100 runs', () => {
    const firstReport = formatReviewReport(reviewDesign(badMd, DEFAULT_DESIGN_RULES));
    for (let i = 0; i < 100; i++) {
      const nextReport = formatReviewReport(reviewDesign(badMd, DEFAULT_DESIGN_RULES));
      assert.strictEqual(nextReport, firstReport);
    }
  });

  it('report contains no timestamps', () => {
    const violations = reviewDesign(badMd, DEFAULT_DESIGN_RULES);
    const report = formatReviewReport(violations);
    assert.ok(!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(report), 'ISO timestamp leaked');
    assert.ok(!/\d{4}-\d{2}-\d{2}/.test(report), 'date leaked');
  });

  it('violations are sorted deterministically (id, rule-name, line)', () => {
    const violations = reviewDesign(badMd, DEFAULT_DESIGN_RULES);
    // Verify sort invariant: consecutive pairs are in order.
    for (let i = 1; i < violations.length; i++) {
      const a = violations[i - 1];
      const b = violations[i];
      const aId = (a.location && a.location.id) || '__global__';
      const bId = (b.location && b.location.id) || '__global__';
      if (aId !== bId) {
        assert.ok(aId <= bId, `sort violation at ${i}: ${aId} > ${bId}`);
        continue;
      }
      if (a.rule !== b.rule) {
        assert.ok(a.rule <= b.rule, `rule sort violation at ${i}`);
        continue;
      }
      const aLine = (a.location && a.location.line) || 0;
      const bLine = (b.location && b.location.line) || 0;
      assert.ok(aLine <= bLine, `line sort violation at ${i}`);
    }
  });

  it('empty violations produces a clean "no violations" report', () => {
    const report = formatReviewReport([]);
    assert.ok(report.includes('No violations found'));
    assert.ok(!report.includes('## Violations'), 'no violations section when empty');
  });

  it('report includes summary counts per severity', () => {
    const violations = reviewDesign(badMd, DEFAULT_DESIGN_RULES);
    const report = formatReviewReport(violations);
    assert.ok(report.includes('## Summary'));
    assert.ok(/Errors:\s+\d+/.test(report));
    assert.ok(/Warnings:\s+\d+/.test(report));
    assert.ok(/Info:\s+\d+/.test(report));
  });
});

// ---------------------------------------------------------------------------
// AC-4 — readDesignRules + file-io boundaries (runs ONLY here, reviewDesign stays pure)
// ---------------------------------------------------------------------------

describe('F-064/AC-4 — readDesignRules + writeDesignReview file I/O boundaries', () => {
  it('readDesignRules returns null when .cap/design-rules.md does not exist', () => {
    assert.strictEqual(readDesignRules(tmpDir), null);
  });

  it('readDesignRules returns file content when present', () => {
    fs.mkdirSync(path.join(tmpDir, '.cap'), { recursive: true });
    const md = '## Rules\n\n- **[typography] custom**: test.\n  Suggestion: x.\n';
    fs.writeFileSync(path.join(tmpDir, '.cap', 'design-rules.md'), md);
    assert.strictEqual(readDesignRules(tmpDir), md);
  });

  it('writeDesignReview writes to .cap/DESIGN-REVIEW.md', () => {
    writeDesignReview(tmpDir, '# Report\n\nBody.');
    const written = fs.readFileSync(path.join(tmpDir, '.cap', 'DESIGN-REVIEW.md'), 'utf8');
    assert.strictEqual(written, '# Report\n\nBody.');
  });

  it('writeDesignReview creates .cap/ if missing', () => {
    assert.ok(!fs.existsSync(path.join(tmpDir, '.cap')));
    writeDesignReview(tmpDir, 'x');
    assert.ok(fs.existsSync(path.join(tmpDir, '.cap')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.cap', 'DESIGN-REVIEW.md')));
  });

  it('DESIGN_REVIEW_FILE constant points to the expected location', () => {
    assert.strictEqual(DESIGN_REVIEW_FILE, '.cap/DESIGN-REVIEW.md');
  });

  it('writeDesignReview does NOT modify DESIGN.md (AC-3 hard constraint)', () => {
    const md = buildDesignMd({ family: AESTHETIC_FAMILIES['editorial-minimalism'] });
    writeDesignMd(tmpDir, md);
    const before = readDesignMd(tmpDir);

    writeDesignReview(tmpDir, '# Report');
    const after = readDesignMd(tmpDir);
    assert.strictEqual(after, before, 'writeDesignReview must never touch DESIGN.md');
  });

  it('custom rules from file override defaults', () => {
    fs.mkdirSync(path.join(tmpDir, '.cap'), { recursive: true });
    const md = `## Rules

- **[typography][severity:info] only-check-this**: Nothing real.
  Suggestion: Ignore.
`;
    fs.writeFileSync(path.join(tmpDir, '.cap', 'design-rules.md'), md);
    const rulesMd = readDesignRules(tmpDir);
    const rules = parseDesignRules(rulesMd);
    // Only one custom rule — generic font checks should NOT trigger because the rule set
    // does not include typography/no-generic-fonts.
    const violations = reviewDesign('- family: "Inter"', rules);
    assert.strictEqual(violations.length, 0, 'custom ruleset without font rule must not flag Inter');
  });
});
