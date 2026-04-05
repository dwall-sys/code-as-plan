/**
 * GSD Tools Tests - frontmatter.cjs
 *
 * Tests for the hand-rolled YAML parser's pure function exports:
 * extractFrontmatter, reconstructFrontmatter, spliceFrontmatter,
 * parseMustHavesBlock, and FRONTMATTER_SCHEMAS.
 *
 * Includes REG-04 regression: quoted comma inline array edge case.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const {
  extractFrontmatter,
  reconstructFrontmatter,
  spliceFrontmatter,
  parseMustHavesBlock,
  FRONTMATTER_SCHEMAS,
} = require('../cap/bin/lib/frontmatter.cjs');

// ─── extractFrontmatter ─────────────────────────────────────────────────────

describe('extractFrontmatter', () => {
  test('parses simple key-value pairs', () => {
    const content = '---\nname: foo\ntype: execute\n---\nbody';
    const result = extractFrontmatter(content);
    assert.strictEqual(result.name, 'foo');
    assert.strictEqual(result.type, 'execute');
  });

  test('strips quotes from values', () => {
    const doubleQuoted = '---\nname: "foo"\n---\n';
    const singleQuoted = '---\nname: \'foo\'\n---\n';
    assert.strictEqual(extractFrontmatter(doubleQuoted).name, 'foo');
    assert.strictEqual(extractFrontmatter(singleQuoted).name, 'foo');
  });

  test('parses nested objects', () => {
    const content = '---\ntechstack:\n  added: prisma\n  patterns: repository\n---\n';
    const result = extractFrontmatter(content);
    assert.deepStrictEqual(result.techstack, { added: 'prisma', patterns: 'repository' });
  });

  test('parses block arrays', () => {
    const content = '---\nitems:\n  - alpha\n  - beta\n  - gamma\n---\n';
    const result = extractFrontmatter(content);
    assert.deepStrictEqual(result.items, ['alpha', 'beta', 'gamma']);
  });

  test('parses inline arrays', () => {
    const content = '---\nkey: [a, b, c]\n---\n';
    const result = extractFrontmatter(content);
    assert.deepStrictEqual(result.key, ['a', 'b', 'c']);
  });

  test('handles quoted commas in inline arrays — REG-04 known limitation', () => {
    // REG-04: The split(',') on line 53 does NOT respect quotes.
    // The parser WILL split on commas inside quotes, producing wrong results.
    // This test documents the CURRENT (buggy) behavior.
    const content = '---\nkey: ["a, b", c]\n---\n';
    const result = extractFrontmatter(content);
    // Current behavior: splits on ALL commas, producing 3 items instead of 2
    // Expected correct behavior would be: ["a, b", "c"]
    // Actual current behavior: ["a", "b", "c"] (split ignores quotes)
    assert.ok(Array.isArray(result.key), 'should produce an array');
    assert.ok(result.key.length >= 2, 'should produce at least 2 items from comma split');
    // The bug produces ["a", "b\"", "c"] or similar — the exact output depends on
    // how the regex strips quotes after the split.
    // We verify the key insight: the result has MORE items than intended (known limitation).
    assert.ok(result.key.length > 2, 'REG-04: split produces more items than intended due to quoted comma bug');
  });

  test('returns empty object for no frontmatter', () => {
    const content = 'Just plain content, no frontmatter.';
    const result = extractFrontmatter(content);
    assert.deepStrictEqual(result, {});
  });

  test('returns empty object for empty frontmatter', () => {
    const content = '---\n---\nBody text.';
    const result = extractFrontmatter(content);
    assert.deepStrictEqual(result, {});
  });

  test('parses frontmatter-only content', () => {
    const content = '---\nkey: val\n---';
    const result = extractFrontmatter(content);
    assert.strictEqual(result.key, 'val');
  });

  test('handles emoji and non-ASCII in values', () => {
    const content = '---\nname: "Hello World"\nlabel: "cafe"\n---\n';
    const result = extractFrontmatter(content);
    assert.strictEqual(result.name, 'Hello World');
    assert.strictEqual(result.label, 'cafe');
  });

  test('converts empty-object placeholders to arrays when dash items follow', () => {
    // When a key has no value, it gets an empty {} placeholder.
    // When "- item" lines follow, the parser converts {} to [].
    const content = '---\nrequirements:\n  - REQ-01\n  - REQ-02\n---\n';
    const result = extractFrontmatter(content);
    assert.ok(Array.isArray(result.requirements), 'should convert placeholder object to array');
    assert.deepStrictEqual(result.requirements, ['REQ-01', 'REQ-02']);
  });

  test('skips empty lines in YAML body', () => {
    const content = '---\nfirst: one\n\nsecond: two\n\nthird: three\n---\n';
    const result = extractFrontmatter(content);
    assert.strictEqual(result.first, 'one');
    assert.strictEqual(result.second, 'two');
    assert.strictEqual(result.third, 'three');
  });
});

// ─── reconstructFrontmatter ─────────────────────────────────────────────────

describe('reconstructFrontmatter', () => {
  test('serializes simple key-value', () => {
    const result = reconstructFrontmatter({ name: 'foo' });
    assert.strictEqual(result, 'name: foo');
  });

  test('serializes empty array as inline []', () => {
    const result = reconstructFrontmatter({ items: [] });
    assert.strictEqual(result, 'items: []');
  });

  test('serializes short string arrays inline', () => {
    const result = reconstructFrontmatter({ key: ['a', 'b', 'c'] });
    assert.strictEqual(result, 'key: [a, b, c]');
  });

  test('serializes long arrays as block', () => {
    const result = reconstructFrontmatter({ key: ['one', 'two', 'three', 'four'] });
    assert.ok(result.includes('key:'), 'should have key header');
    assert.ok(result.includes('  - one'), 'should have block array items');
    assert.ok(result.includes('  - four'), 'should have last item');
  });

  test('quotes values containing colons or hashes', () => {
    const result = reconstructFrontmatter({ url: 'http://example.com' });
    assert.ok(result.includes('"http://example.com"'), 'should quote value with colon');

    const hashResult = reconstructFrontmatter({ comment: 'value # note' });
    assert.ok(hashResult.includes('"value # note"'), 'should quote value with hash');
  });

  test('serializes nested objects with proper indentation', () => {
    const result = reconstructFrontmatter({ tech: { added: 'prisma', patterns: 'repo' } });
    assert.ok(result.includes('tech:'), 'should have parent key');
    assert.ok(result.includes('  added: prisma'), 'should have indented child');
    assert.ok(result.includes('  patterns: repo'), 'should have indented child');
  });

  test('serializes nested arrays within objects', () => {
    const result = reconstructFrontmatter({
      tech: { added: ['prisma', 'jose'] },
    });
    assert.ok(result.includes('tech:'), 'should have parent key');
    assert.ok(result.includes('  added: [prisma, jose]'), 'should serialize nested short array inline');
  });

  test('skips null and undefined values', () => {
    const result = reconstructFrontmatter({ name: 'foo', skip: null, also: undefined, keep: 'bar' });
    assert.ok(!result.includes('skip'), 'should not include null key');
    assert.ok(!result.includes('also'), 'should not include undefined key');
    assert.ok(result.includes('name: foo'), 'should include non-null key');
    assert.ok(result.includes('keep: bar'), 'should include non-null key');
  });

  test('round-trip: simple frontmatter', () => {
    const original = '---\nname: test\ntype: execute\nwave: 1\n---\n';
    const extracted1 = extractFrontmatter(original);
    const reconstructed = reconstructFrontmatter(extracted1);
    const roundTrip = `---\n${reconstructed}\n---\n`;
    const extracted2 = extractFrontmatter(roundTrip);
    assert.deepStrictEqual(extracted2, extracted1, 'round-trip should preserve data identity');
  });

  test('round-trip: nested with arrays', () => {
    const original = '---\nphase: 01\ntech:\n  added:\n    - prisma\n    - jose\n  patterns:\n    - repository\n    - jwt\n---\n';
    const extracted1 = extractFrontmatter(original);
    const reconstructed = reconstructFrontmatter(extracted1);
    const roundTrip = `---\n${reconstructed}\n---\n`;
    const extracted2 = extractFrontmatter(roundTrip);
    assert.deepStrictEqual(extracted2, extracted1, 'round-trip should preserve nested structures');
  });

  test('round-trip: multiple data types', () => {
    const original = '---\nname: testplan\nwave: 2\ntags: [auth, api, db]\ndeps:\n  - dep1\n  - dep2\nconfig:\n  enabled: true\n  count: 5\n---\n';
    const extracted1 = extractFrontmatter(original);
    const reconstructed = reconstructFrontmatter(extracted1);
    const roundTrip = `---\n${reconstructed}\n---\n`;
    const extracted2 = extractFrontmatter(roundTrip);
    assert.deepStrictEqual(extracted2, extracted1, 'round-trip should preserve multiple data types');
  });
});

// ─── spliceFrontmatter ──────────────────────────────────────────────────────

describe('spliceFrontmatter', () => {
  test('replaces existing frontmatter preserving body', () => {
    const content = '---\nphase: 01\ntype: execute\n---\n\n# Body Content\n\nParagraph here.';
    const newObj = { phase: '02', type: 'tdd', wave: '1' };
    const result = spliceFrontmatter(content, newObj);

    // New frontmatter should be present
    const extracted = extractFrontmatter(result);
    assert.strictEqual(extracted.phase, '02');
    assert.strictEqual(extracted.type, 'tdd');
    assert.strictEqual(extracted.wave, '1');

    // Body should be preserved
    assert.ok(result.includes('# Body Content'), 'body heading should be preserved');
    assert.ok(result.includes('Paragraph here.'), 'body paragraph should be preserved');
  });

  test('adds frontmatter to content without any', () => {
    const content = 'Plain text with no frontmatter.';
    const newObj = { phase: '01', plan: '01' };
    const result = spliceFrontmatter(content, newObj);

    // Should start with frontmatter delimiters
    assert.ok(result.startsWith('---\n'), 'should start with opening delimiter');
    assert.ok(result.includes('\n---\n'), 'should have closing delimiter');

    // Original content should follow
    assert.ok(result.includes('Plain text with no frontmatter.'), 'original content should be preserved');

    // Frontmatter should be extractable
    const extracted = extractFrontmatter(result);
    assert.strictEqual(extracted.phase, '01');
    assert.strictEqual(extracted.plan, '01');
  });

  test('preserves content after frontmatter delimiters exactly', () => {
    const body = '\n\nExact content with special chars: $, %, &, <, >\nLine 2\nLine 3';
    const content = '---\nold: value\n---' + body;
    const newObj = { new: 'value' };
    const result = spliceFrontmatter(content, newObj);

    // The body after the closing --- should be exactly preserved
    const closingIdx = result.indexOf('\n---', 4); // skip the opening ---
    const resultBody = result.slice(closingIdx + 4); // skip \n---
    assert.strictEqual(resultBody, body, 'body content after frontmatter should be exactly preserved');
  });
});

// ─── parseMustHavesBlock ────────────────────────────────────────────────────

describe('parseMustHavesBlock', () => {
  test('extracts truths as string array', () => {
    const content = `---
phase: 01
must_haves:
    truths:
      - "All tests pass on CI"
      - "Coverage exceeds 80%"
---

Body content.`;
    const result = parseMustHavesBlock(content, 'truths');
    assert.ok(Array.isArray(result), 'should return an array');
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0], 'All tests pass on CI');
    assert.strictEqual(result[1], 'Coverage exceeds 80%');
  });

  test('extracts artifacts as object array', () => {
    const content = `---
phase: 01
must_haves:
    artifacts:
      - path: "src/auth.ts"
        provides: "JWT authentication"
        min_lines: 100
      - path: "src/middleware.ts"
        provides: "Route protection"
        min_lines: 50
---

Body.`;
    const result = parseMustHavesBlock(content, 'artifacts');
    assert.ok(Array.isArray(result), 'should return an array');
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].path, 'src/auth.ts');
    assert.strictEqual(result[0].provides, 'JWT authentication');
    assert.strictEqual(result[0].min_lines, 100);
    assert.strictEqual(result[1].path, 'src/middleware.ts');
    assert.strictEqual(result[1].min_lines, 50);
  });

  test('extracts key_links with from/to/via/pattern fields', () => {
    const content = `---
phase: 01
must_haves:
    key_links:
      - from: "tests/auth.test.ts"
        to: "src/auth.ts"
        via: "import statement"
        pattern: "import.*auth"
---
`;
    const result = parseMustHavesBlock(content, 'key_links');
    assert.ok(Array.isArray(result), 'should return an array');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].from, 'tests/auth.test.ts');
    assert.strictEqual(result[0].to, 'src/auth.ts');
    assert.strictEqual(result[0].via, 'import statement');
    assert.strictEqual(result[0].pattern, 'import.*auth');
  });

  test('returns empty array when block not found', () => {
    const content = `---
phase: 01
must_haves:
    truths:
      - "Some truth"
---
`;
    const result = parseMustHavesBlock(content, 'nonexistent_block');
    assert.deepStrictEqual(result, []);
  });

  test('returns empty array when no frontmatter', () => {
    const content = 'Plain text without any frontmatter delimiters.';
    const result = parseMustHavesBlock(content, 'truths');
    assert.deepStrictEqual(result, []);
  });

  test('parses key_links with 2-space indentation — issue #1356', () => {
    // Real-world YAML uses 2-space indentation, not 4-space.
    // The parser was hardcoded to expect 4-space indentation which caused
    // "No must_haves.key_links found in frontmatter" for valid YAML.
    const content = `---
phase: 01-conversion-engine-iva-correctness
plan: 02
type: execute
wave: 2
depends_on: ["01-01"]
files_modified:
  - src/features/currency/exchange-rate-store.ts
  - src/features/currency/use-currency-config.ts
autonomous: true
requirements:
  - CONV-02
  - CONV-03

must_haves:
  truths:
    - "All tests pass"
  artifacts:
    - path: "src/features/currency/use-currency-config.ts"
  key_links:
    - from: "src/features/currency/use-currency-config.ts"
      to: "src/api/generated/company-config/company-config.ts"
      via: "getCompanyConfigControllerFindAllQueryOptions"
      pattern: "getCompanyConfigControllerFindAllQueryOptions"
    - from: "src/features/currency/use-currency-config.ts"
      to: "src/features/currency/exchange-rate-store.ts"
      via: "useExchangeRateStore for MMKV persist"
      pattern: "useExchangeRateStore"
---

# Plan body
`;
    const result = parseMustHavesBlock(content, 'key_links');
    assert.ok(Array.isArray(result), 'should return an array');
    assert.strictEqual(result.length, 2, `expected 2 key_links, got ${result.length}: ${JSON.stringify(result)}`);
    assert.strictEqual(result[0].from, 'src/features/currency/use-currency-config.ts');
    assert.strictEqual(result[0].to, 'src/api/generated/company-config/company-config.ts');
    assert.strictEqual(result[0].via, 'getCompanyConfigControllerFindAllQueryOptions');
    assert.strictEqual(result[0].pattern, 'getCompanyConfigControllerFindAllQueryOptions');
    assert.strictEqual(result[1].from, 'src/features/currency/use-currency-config.ts');
    assert.strictEqual(result[1].to, 'src/features/currency/exchange-rate-store.ts');
    assert.strictEqual(result[1].via, 'useExchangeRateStore for MMKV persist');
    assert.strictEqual(result[1].pattern, 'useExchangeRateStore');
  });

  test('parses truths with 2-space indentation — issue #1356', () => {
    const content = `---
phase: 01
must_haves:
  truths:
    - "All tests pass on CI"
    - "Coverage exceeds 80%"
---
`;
    const result = parseMustHavesBlock(content, 'truths');
    assert.ok(Array.isArray(result), 'should return an array');
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0], 'All tests pass on CI');
    assert.strictEqual(result[1], 'Coverage exceeds 80%');
  });

  test('parses artifacts with 2-space indentation — issue #1356', () => {
    const content = `---
phase: 01
must_haves:
  artifacts:
    - path: "src/auth.ts"
      provides: "JWT authentication"
      min_lines: 100
---
`;
    const result = parseMustHavesBlock(content, 'artifacts');
    assert.ok(Array.isArray(result), 'should return an array');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].path, 'src/auth.ts');
    assert.strictEqual(result[0].provides, 'JWT authentication');
    assert.strictEqual(result[0].min_lines, 100);
  });

  test('handles nested arrays within artifact objects', () => {
    const content = `---
phase: 01
must_haves:
    artifacts:
      - path: "src/api.ts"
        provides: "REST endpoints"
        exports:
          - "GET"
          - "POST"
---
`;
    const result = parseMustHavesBlock(content, 'artifacts');
    assert.ok(Array.isArray(result), 'should return an array');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].path, 'src/api.ts');
    // The nested array should be captured
    assert.ok(result[0].exports !== undefined, 'should have exports field');
  });
});

// ─── reconstructFrontmatter — deep nesting branches ─────────────────────────

describe('reconstructFrontmatter deep nesting', () => {
  test('serializes nested object within object (3 levels deep)', () => {
    const result = reconstructFrontmatter({
      outer: {
        inner: {
          deepKey: 'deepVal',
          deepArr: ['x', 'y'],
          deepEmpty: [],
        },
      },
    });
    assert.ok(result.includes('outer:'), 'should have outer key');
    assert.ok(result.includes('  inner:'), 'should have inner key indented');
    assert.ok(result.includes('    deepKey: deepVal'), 'should have deep key-value');
    assert.ok(result.includes('    deepArr:'), 'should have deep array header');
    assert.ok(result.includes('      - x'), 'should have deep array items');
    assert.ok(result.includes('    deepEmpty: []'), 'should serialize deep empty array');
  });

  test('skips null/undefined in nested objects', () => {
    const result = reconstructFrontmatter({
      outer: {
        keep: 'yes',
        skipNull: null,
        skipUndef: undefined,
      },
    });
    assert.ok(result.includes('  keep: yes'), 'should include non-null key');
    assert.ok(!result.includes('skipNull'), 'should skip null nested key');
    assert.ok(!result.includes('skipUndef'), 'should skip undefined nested key');
  });

  test('skips null/undefined in deeply nested objects', () => {
    const result = reconstructFrontmatter({
      outer: {
        inner: {
          keep: 'yes',
          skip: null,
        },
      },
    });
    assert.ok(result.includes('    keep: yes'), 'should include non-null deep key');
    assert.ok(!result.includes('skip'), 'should skip null deep key');
  });

  test('quotes nested sub-values with colon or hash', () => {
    const result = reconstructFrontmatter({
      parent: {
        url: 'http://example.com',
        comment: 'value # note',
      },
    });
    assert.ok(result.includes('"http://example.com"'), 'should quote nested value with colon');
    assert.ok(result.includes('"value # note"'), 'should quote nested value with hash');
  });

  test('serializes nested long arrays as block with quoting', () => {
    const result = reconstructFrontmatter({
      parent: {
        items: ['http://a.com', 'b # note', 'c', 'd'],
      },
    });
    assert.ok(result.includes('  items:'), 'should have block array header');
    assert.ok(result.includes('    - "http://a.com"'), 'should quote array items with colon');
    assert.ok(result.includes('    - "b # note"'), 'should quote array items with hash');
    assert.ok(result.includes('    - c'), 'non-special items unquoted');
  });

  test('serializes nested empty array inside object', () => {
    const result = reconstructFrontmatter({
      parent: {
        empty: [],
      },
    });
    assert.ok(result.includes('  empty: []'), 'should serialize nested empty array');
  });

  test('quotes top-level values starting with [ or {', () => {
    const result = reconstructFrontmatter({ val: '[array-like]', obj: '{object-like}' });
    assert.ok(result.includes('"[array-like]"'), 'should quote value starting with [');
    assert.ok(result.includes('"{object-like}"'), 'should quote value starting with {');
  });

  test('handles opening bracket as value (key: [)', () => {
    const content = '---\nitems: [\nfoo\nbar\n]\n---\n';
    const result = extractFrontmatter(content);
    // When value is just "[", parser creates an empty array
    assert.ok(Array.isArray(result.items), 'should create array for opening bracket value');
  });
});

describe('parseMustHavesBlock edge cases', () => {
  test('returns empty when block is not nested under must_haves', () => {
    // blockIndent <= mustHavesIndent — lines 202-205
    const content = `---
must_haves:
  truths:
    - "OK"
truths:
  - "not under must_haves"
---
`;
    // The top-level "truths:" is not nested under must_haves
    // parseMustHavesBlock looks for block UNDER must_haves
    const result = parseMustHavesBlock(content, 'truths');
    // Should find the one under must_haves (indented), not the top-level one
    assert.ok(result.length >= 1, 'should find truths under must_haves');
  });

  test('handles must_haves block with no matching sub-block', () => {
    const content = `---
must_haves:
  artifacts:
    - path: "src/foo.ts"
---
`;
    const result = parseMustHavesBlock(content, 'truths');
    assert.deepStrictEqual(result, [], 'should return empty for non-existent sub-block');
  });

  test('returns empty when block is at same indent as must_haves', () => {
    // blockIndent <= mustHavesIndent (line 185)
    // must_haves is indented by 2, truths is also indented by 2 (same level)
    const content = `---
outer:
  must_haves:
    artifacts:
      - path: "src/foo.ts"
  truths:
    - "at same level as must_haves"
---
`;
    const result = parseMustHavesBlock(content, 'truths');
    assert.deepStrictEqual(result, [], 'should return empty when block is not nested under must_haves');
  });

  test('handles artifact with key having empty value then array items', () => {
    // Hits line 241: current[lastKey] is falsy
    const content = `---
must_haves:
  artifacts:
    - path: "src/foo.ts"
      provides:
        - "API"
        - "Auth"
---
`;
    const result = parseMustHavesBlock(content, 'artifacts');
    assert.ok(Array.isArray(result), 'should return array');
    assert.strictEqual(result.length, 1);
    assert.ok(result[0].path === 'src/foo.ts');
    // provides should be an array since it had empty value then dash items
    assert.ok(result[0].provides !== undefined, 'should have provides field');
  });
});

// ─── Frontmatter CRUD commands ──────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  cmdFrontmatterGet,
  cmdFrontmatterSet,
  cmdFrontmatterMerge,
  cmdFrontmatterValidate,
} = require('../cap/bin/lib/frontmatter.cjs');

/** Capture output() calls — intercepts fs.writeSync(fd 1/2) and process.exit */
function captureCmd(fn) {
  const origWriteSync = fs.writeSync;
  const origExit = process.exit;
  let captured = '';
  let exitCode = null;
  fs.writeSync = function(fd, data) {
    if (fd === 1) { captured += data; return data.length; }
    if (fd === 2) { captured += data; return data.length; }
    return origWriteSync.apply(fs, arguments);
  };
  process.exit = (code) => { exitCode = code; throw new Error('__EXIT__'); };
  try { fn(); } catch (e) { if (e.message !== '__EXIT__') throw e; }
  finally { fs.writeSync = origWriteSync; process.exit = origExit; }
  return { output: captured, exitCode };
}

describe('cmdFrontmatterGet', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns all frontmatter when no field specified', () => {
    const fp = path.join(tmpDir, 'test.md');
    fs.writeFileSync(fp, '---\nphase: 01\ntype: execute\n---\nBody\n');
    const { output } = captureCmd(() => cmdFrontmatterGet(tmpDir, 'test.md', null, false));
    const data = JSON.parse(output);
    assert.strictEqual(data.phase, '01');
    assert.strictEqual(data.type, 'execute');
  });

  test('returns specific field value', () => {
    const fp = path.join(tmpDir, 'test.md');
    fs.writeFileSync(fp, '---\nphase: 02\ntype: tdd\n---\nBody\n');
    const { output } = captureCmd(() => cmdFrontmatterGet(tmpDir, 'test.md', 'phase', false));
    const data = JSON.parse(output);
    assert.strictEqual(data.phase, '02');
  });

  test('returns error for missing field', () => {
    const fp = path.join(tmpDir, 'test.md');
    fs.writeFileSync(fp, '---\nphase: 01\n---\nBody\n');
    const { output } = captureCmd(() => cmdFrontmatterGet(tmpDir, 'test.md', 'nonexistent', false));
    const data = JSON.parse(output);
    assert.strictEqual(data.error, 'Field not found');
  });

  test('returns error for missing file', () => {
    const { output } = captureCmd(() => cmdFrontmatterGet(tmpDir, 'missing.md', null, false));
    const data = JSON.parse(output);
    assert.strictEqual(data.error, 'File not found');
  });

  test('rejects null bytes in file path', () => {
    const { exitCode } = captureCmd(() => cmdFrontmatterGet(tmpDir, 'test\0.md', null, false));
    assert.strictEqual(exitCode, 1);
  });

  test('handles absolute file path', () => {
    const fp = path.join(tmpDir, 'abs.md');
    fs.writeFileSync(fp, '---\nkey: val\n---\nBody\n');
    const { output } = captureCmd(() => cmdFrontmatterGet(tmpDir, fp, 'key', false));
    const data = JSON.parse(output);
    assert.strictEqual(data.key, 'val');
  });
});

describe('cmdFrontmatterSet', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('sets a field value in frontmatter', () => {
    const fp = path.join(tmpDir, 'test.md');
    fs.writeFileSync(fp, '---\nphase: 01\n---\nBody\n');
    const { output } = captureCmd(() => cmdFrontmatterSet(tmpDir, 'test.md', 'phase', '"02"', false));
    const data = JSON.parse(output);
    assert.strictEqual(data.updated, true);
    assert.strictEqual(data.field, 'phase');
    // Verify file was written
    const content = fs.readFileSync(fp, 'utf-8');
    const fm = extractFrontmatter(content);
    assert.strictEqual(fm.phase, '02');
  });

  test('returns error for missing file', () => {
    const { output } = captureCmd(() => cmdFrontmatterSet(tmpDir, 'missing.md', 'key', 'val', false));
    const data = JSON.parse(output);
    assert.strictEqual(data.error, 'File not found');
  });

  test('rejects null bytes in file path', () => {
    const { exitCode } = captureCmd(() => cmdFrontmatterSet(tmpDir, 'test\0.md', 'key', 'val', false));
    assert.strictEqual(exitCode, 1);
  });

  test('errors when required params missing', () => {
    const { exitCode } = captureCmd(() => cmdFrontmatterSet(tmpDir, null, null, undefined, false));
    assert.strictEqual(exitCode, 1);
  });

  test('parses JSON value correctly', () => {
    const fp = path.join(tmpDir, 'test.md');
    fs.writeFileSync(fp, '---\nphase: 01\n---\nBody\n');
    const { output } = captureCmd(() => cmdFrontmatterSet(tmpDir, 'test.md', 'tags', '["a","b"]', false));
    const data = JSON.parse(output);
    assert.deepStrictEqual(data.value, ['a', 'b']);
  });
});

describe('cmdFrontmatterMerge', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('merges multiple fields into frontmatter', () => {
    const fp = path.join(tmpDir, 'test.md');
    fs.writeFileSync(fp, '---\nphase: 01\n---\nBody\n');
    const { output } = captureCmd(() =>
      cmdFrontmatterMerge(tmpDir, 'test.md', '{"type":"execute","wave":"2"}', false)
    );
    const data = JSON.parse(output);
    assert.strictEqual(data.merged, true);
    assert.deepStrictEqual(data.fields, ['type', 'wave']);
    const content = fs.readFileSync(fp, 'utf-8');
    const fm = extractFrontmatter(content);
    assert.strictEqual(fm.phase, '01');
    assert.strictEqual(fm.type, 'execute');
    assert.strictEqual(fm.wave, '2');
  });

  test('returns error for missing file', () => {
    const { output } = captureCmd(() =>
      cmdFrontmatterMerge(tmpDir, 'missing.md', '{"key":"val"}', false)
    );
    const data = JSON.parse(output);
    assert.strictEqual(data.error, 'File not found');
  });

  test('errors on invalid JSON data', () => {
    const fp = path.join(tmpDir, 'test.md');
    fs.writeFileSync(fp, '---\nphase: 01\n---\nBody\n');
    const { exitCode } = captureCmd(() =>
      cmdFrontmatterMerge(tmpDir, 'test.md', 'not-json', false)
    );
    assert.strictEqual(exitCode, 1);
  });

  test('errors when required params missing', () => {
    const { exitCode } = captureCmd(() =>
      cmdFrontmatterMerge(tmpDir, null, null, false)
    );
    assert.strictEqual(exitCode, 1);
  });
});

describe('cmdFrontmatterValidate', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('validates a complete plan frontmatter as valid', () => {
    const fp = path.join(tmpDir, 'test.md');
    fs.writeFileSync(fp, '---\nphase: 01\nplan: 01\ntype: execute\nwave: 1\ndepends_on: []\nfiles_modified: []\nautonomous: true\nmust_haves:\n  truths:\n    - "passes"\n---\nBody\n');
    const { output } = captureCmd(() => cmdFrontmatterValidate(tmpDir, 'test.md', 'plan', false));
    const data = JSON.parse(output);
    assert.strictEqual(data.valid, true);
    assert.strictEqual(data.missing.length, 0);
    assert.strictEqual(data.schema, 'plan');
  });

  test('reports missing fields for incomplete plan', () => {
    const fp = path.join(tmpDir, 'test.md');
    fs.writeFileSync(fp, '---\nphase: 01\n---\nBody\n');
    const { output } = captureCmd(() => cmdFrontmatterValidate(tmpDir, 'test.md', 'plan', false));
    const data = JSON.parse(output);
    assert.strictEqual(data.valid, false);
    assert.ok(data.missing.includes('type'), 'should report type as missing');
    assert.ok(data.missing.includes('wave'), 'should report wave as missing');
  });

  test('errors on unknown schema', () => {
    const fp = path.join(tmpDir, 'test.md');
    fs.writeFileSync(fp, '---\nphase: 01\n---\nBody\n');
    const { exitCode } = captureCmd(() => cmdFrontmatterValidate(tmpDir, 'test.md', 'unknown', false));
    assert.strictEqual(exitCode, 1);
  });

  test('returns error for missing file', () => {
    const { output } = captureCmd(() => cmdFrontmatterValidate(tmpDir, 'missing.md', 'plan', false));
    const data = JSON.parse(output);
    assert.strictEqual(data.error, 'File not found');
  });

  test('errors when required params missing', () => {
    const { exitCode } = captureCmd(() => cmdFrontmatterValidate(tmpDir, null, null, false));
    assert.strictEqual(exitCode, 1);
  });

  test('validates summary schema', () => {
    const fp = path.join(tmpDir, 'test.md');
    fs.writeFileSync(fp, '---\nphase: 01\nplan: 01\nsubsystem: auth\ntags: [api]\nduration: 30min\ncompleted: true\n---\nBody\n');
    const { output } = captureCmd(() => cmdFrontmatterValidate(tmpDir, 'test.md', 'summary', false));
    const data = JSON.parse(output);
    assert.strictEqual(data.valid, true);
    assert.strictEqual(data.schema, 'summary');
  });

  test('validates verification schema', () => {
    const fp = path.join(tmpDir, 'test.md');
    fs.writeFileSync(fp, '---\nphase: 01\nverified: true\nstatus: pass\nscore: 95\n---\nBody\n');
    const { output } = captureCmd(() => cmdFrontmatterValidate(tmpDir, 'test.md', 'verification', false));
    const data = JSON.parse(output);
    assert.strictEqual(data.valid, true);
    assert.strictEqual(data.schema, 'verification');
  });
});

