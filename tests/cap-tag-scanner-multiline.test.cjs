'use strict';

// @cap-feature(feature:F-094) Test suite for multi-line @cap-* description capture.
//   Pins AC-1..AC-8: continuation-pickup for line- and block-comments, stop-conditions,
//   feature-flag opt-out, anchor-line preservation, whitespace normalization.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  extractTags,
  detectAnchorToken,
  captureContinuations,
  isMultilineCaptureEnabled,
  scanFile,
} = require('../cap/bin/lib/cap-tag-scanner.cjs');

// ---------------------------------------------------------------------------
// detectAnchorToken — unit
// ---------------------------------------------------------------------------

test('detectAnchorToken — line comment // ', () => {
  assert.strictEqual(detectAnchorToken('// @cap-decision foo'), '//');
  assert.strictEqual(detectAnchorToken('  // foo'), '//');
});

test('detectAnchorToken — line comment # and --', () => {
  assert.strictEqual(detectAnchorToken('# @cap-decision foo'), '#');
  assert.strictEqual(detectAnchorToken('-- @cap-decision foo'), '--');
});

test('detectAnchorToken — block-open /*', () => {
  assert.strictEqual(detectAnchorToken('/* @cap-decision foo'), '/*');
});

test('detectAnchorToken — JSDoc body * (block-body line)', () => {
  assert.strictEqual(detectAnchorToken(' * @cap-decision foo'), '*');
});

test('detectAnchorToken — triple quotes', () => {
  assert.strictEqual(detectAnchorToken('""" @cap-decision foo'), '"""');
  assert.strictEqual(detectAnchorToken("''' @cap-decision foo"), "'''");
});

test('detectAnchorToken — no comment token returns null', () => {
  assert.strictEqual(detectAnchorToken('const x = 1;'), null);
  assert.strictEqual(detectAnchorToken(''), null);
});

// ---------------------------------------------------------------------------
// captureContinuations — unit (AC-1, AC-2, AC-3, AC-5)
// ---------------------------------------------------------------------------

test('captureContinuations: line-comment // continuation appended', () => {
  const lines = [
    '// @cap-decision Foo bar',
    '//   baz qux',
    '//   end here',
    'const x = 1;',
  ];
  const cont = captureContinuations(lines, 1, '//');
  assert.deepStrictEqual(cont, ['baz qux', 'end here']);
});

test('captureContinuations: stops at empty line (AC-2)', () => {
  const lines = [
    '// @cap-decision Foo',
    '//   bar',
    '',
    '//   not picked up',
  ];
  const cont = captureContinuations(lines, 1, '//');
  assert.deepStrictEqual(cont, ['bar']);
});

test('captureContinuations: stops at code line (AC-2)', () => {
  const lines = [
    '// @cap-decision Foo',
    '//   bar',
    'const x = 1;',
  ];
  const cont = captureContinuations(lines, 1, '//');
  assert.deepStrictEqual(cont, ['bar']);
});

test('captureContinuations: stops at new @cap-* tag (AC-2)', () => {
  const lines = [
    '// @cap-decision Foo',
    '//   bar',
    '// @cap-decision New Tag',
  ];
  const cont = captureContinuations(lines, 1, '//');
  assert.deepStrictEqual(cont, ['bar']);
});

test('captureContinuations: stops at new design tag (AC-2)', () => {
  const lines = [
    '// @cap-decision Foo',
    '//   bar',
    '// @cap-design-token(id:DT-001) Token',
  ];
  const cont = captureContinuations(lines, 1, '//');
  assert.deepStrictEqual(cont, ['bar']);
});

test('captureContinuations: line-comment with mixed indent (AC-3)', () => {
  const lines = [
    '// @cap-decision Foo',
    '  //  bar',
    '   //   baz',
  ];
  const cont = captureContinuations(lines, 1, '//');
  assert.deepStrictEqual(cont, ['bar', 'baz']);
});

test('captureContinuations: # comment continuation', () => {
  const lines = [
    '# @cap-decision Foo',
    '#   bar',
    '#   baz',
    'x = 1',
  ];
  const cont = captureContinuations(lines, 1, '#');
  assert.deepStrictEqual(cont, ['bar', 'baz']);
});

test('captureContinuations: -- SQL comment continuation', () => {
  const lines = [
    '-- @cap-decision Foo',
    '--   bar baz',
    '--   end',
  ];
  const cont = captureContinuations(lines, 1, '--');
  assert.deepStrictEqual(cont, ['bar baz', 'end']);
});

test('captureContinuations: block-comment /* body picks up * lines (AC-3)', () => {
  const lines = [
    '/* @cap-decision Foo',
    ' * bar',
    ' *  baz',
    ' */',
  ];
  const cont = captureContinuations(lines, 1, '/*');
  assert.deepStrictEqual(cont, ['bar', 'baz']);
});

test('captureContinuations: block-comment /* body picks up plain indent lines', () => {
  const lines = [
    '/* @cap-decision Foo',
    '   bar',
    '   baz',
    '*/',
  ];
  const cont = captureContinuations(lines, 1, '/*');
  assert.deepStrictEqual(cont, ['bar', 'baz']);
});

test('captureContinuations: block-comment closes on */ in mid-line (AC-2)', () => {
  const lines = [
    '/* @cap-decision Foo',
    ' * bar',
    ' * end here */',
    'const x = 1;',
  ];
  const cont = captureContinuations(lines, 1, '/*');
  assert.deepStrictEqual(cont, ['bar', 'end here']);
});

test('captureContinuations: JSDoc body anchor * continues with * lines, stops cleanly at */', () => {
  const lines = [
    ' * @cap-decision Foo',
    ' * bar',
    ' * baz',
    ' */',
  ];
  const cont = captureContinuations(lines, 1, '*');
  // ` */` does not match the line-comment continuation regex (no whitespace between `*` and `/`),
  // so the loop stops cleanly without picking up the close token. This is the desired behaviour.
  assert.deepStrictEqual(cont, ['bar', 'baz']);
});

test('captureContinuations: triple-quoted block continues until close', () => {
  const lines = [
    '""" @cap-decision Foo',
    '   bar baz',
    '   end """',
    'x = 1',
  ];
  const cont = captureContinuations(lines, 1, '"""');
  assert.deepStrictEqual(cont, ['bar baz', 'end']);
});

test('captureContinuations: returns empty when anchor null', () => {
  const cont = captureContinuations(['const x = 1'], 0, null);
  assert.deepStrictEqual(cont, []);
});

// ---------------------------------------------------------------------------
// extractTags integration (AC-1, AC-4, AC-5, AC-6)
// ---------------------------------------------------------------------------

test('extractTags: real Bastian-style hub pattern — appended description', () => {
  const content = [
    '// @cap-decision Matcher schliesst api NICHT mehr aus — die x-auth-* Headers',
    '//   aus Stage 2 brauchen die Middleware auf /api/*-Pfaden.',
    '//   publicRoutes werden weiter intern gebypassed.',
    'const x = 1;',
  ].join('\n');
  const tags = extractTags(content, 'src/proxy.ts');
  assert.strictEqual(tags.length, 1);
  assert.strictEqual(tags[0].type, 'decision');
  assert.match(tags[0].description, /Matcher schliesst api NICHT mehr aus/);
  assert.match(tags[0].description, /Stage 2 brauchen die Middleware/);
  assert.match(tags[0].description, /publicRoutes werden weiter intern/);
});

test('extractTags: line and raw stay anchored on the @cap-* line (AC-4)', () => {
  const content = [
    'const x = 1;',
    '// @cap-decision Foo',
    '//   bar',
    '//   baz',
  ].join('\n');
  const tags = extractTags(content, 'a.js');
  assert.strictEqual(tags[0].line, 2);
  assert.match(tags[0].raw, /@cap-decision Foo/);
  assert.ok(!tags[0].raw.includes('bar'), 'raw must remain the original first line');
});

test('extractTags: whitespace normalization to single spaces (AC-5)', () => {
  const content = [
    '// @cap-decision   Foo    bar',
    '//      baz       qux',
  ].join('\n');
  const tags = extractTags(content, 'a.js');
  assert.strictEqual(tags[0].description, 'Foo bar baz qux');
});

test('extractTags: opt-out via options.multilineCapture=false (AC-6)', () => {
  const content = [
    '// @cap-decision Foo',
    '//   bar',
    '//   baz',
  ].join('\n');
  const tagsOff = extractTags(content, 'a.js', { multilineCapture: false });
  assert.strictEqual(tagsOff[0].description, 'Foo');
  const tagsOn = extractTags(content, 'a.js', { multilineCapture: true });
  assert.match(tagsOn[0].description, /bar/);
});

test('extractTags: default ON when no options passed (AC-6)', () => {
  const content = [
    '// @cap-decision Foo',
    '//   bar',
  ].join('\n');
  const tags = extractTags(content, 'a.js');
  assert.match(tags[0].description, /bar/);
});

test('extractTags: single-line tag without continuation behaves identically to legacy', () => {
  const content = '// @cap-decision Single line\nconst x = 1;\n';
  const tags = extractTags(content, 'a.js');
  assert.strictEqual(tags[0].description, 'Single line');
});

test('extractTags: design-token continuation picked up too', () => {
  const content = [
    '// @cap-design-token(id:DT-001) Brand color',
    '//   primary palette token used across hub',
  ].join('\n');
  const tags = extractTags(content, 'a.js');
  assert.strictEqual(tags[0].type, 'design-token');
  assert.match(tags[0].description, /primary palette token/);
});

test('extractTags: subtype detection still works on multi-line @cap-todo risk:', () => {
  const content = [
    '// @cap-todo risk: Foo could leak memory',
    '//   when the cache grows unbounded',
  ].join('\n');
  const tags = extractTags(content, 'a.js');
  assert.strictEqual(tags[0].type, 'todo');
  assert.strictEqual(tags[0].subtype, 'risk');
  assert.match(tags[0].description, /memory/);
  assert.match(tags[0].description, /unbounded/);
});

test('extractTags: two adjacent @cap-decisions stay separate (stop-condition)', () => {
  const content = [
    '// @cap-decision First',
    '//   continuation of first',
    '// @cap-decision Second',
    '//   continuation of second',
  ].join('\n');
  const tags = extractTags(content, 'a.js');
  assert.strictEqual(tags.length, 2);
  assert.match(tags[0].description, /continuation of first/);
  assert.ok(!tags[0].description.includes('Second'));
  assert.match(tags[1].description, /continuation of second/);
});

test('extractTags: backward-compat — extractTags.length === 2 (F-046/AC-5 pin)', () => {
  assert.strictEqual(extractTags.length, 2);
});

// ---------------------------------------------------------------------------
// isMultilineCaptureEnabled — opt-out config (AC-6)
// ---------------------------------------------------------------------------

test('isMultilineCaptureEnabled: default true with no projectRoot', () => {
  assert.strictEqual(isMultilineCaptureEnabled(null), true);
  assert.strictEqual(isMultilineCaptureEnabled(undefined), true);
});

test('isMultilineCaptureEnabled: default true when no .cap/config.json exists', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f094-'));
  try {
    assert.strictEqual(isMultilineCaptureEnabled(tmp), true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('isMultilineCaptureEnabled: default true when config exists but no flag', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f094-'));
  try {
    fs.mkdirSync(path.join(tmp, '.cap'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.cap', 'config.json'), JSON.stringify({ unrelated: true }));
    assert.strictEqual(isMultilineCaptureEnabled(tmp), true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('isMultilineCaptureEnabled: false when explicitly disabled', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f094-'));
  try {
    fs.mkdirSync(path.join(tmp, '.cap'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.cap', 'config.json'), JSON.stringify({
      multilineCapture: { enabled: false },
    }));
    assert.strictEqual(isMultilineCaptureEnabled(tmp), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('isMultilineCaptureEnabled: true when explicitly enabled', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f094-'));
  try {
    fs.mkdirSync(path.join(tmp, '.cap'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.cap', 'config.json'), JSON.stringify({
      multilineCapture: { enabled: true },
    }));
    assert.strictEqual(isMultilineCaptureEnabled(tmp), true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('isMultilineCaptureEnabled: true on malformed JSON (graceful fallback)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f094-'));
  try {
    fs.mkdirSync(path.join(tmp, '.cap'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.cap', 'config.json'), '{ this is not json');
    assert.strictEqual(isMultilineCaptureEnabled(tmp), true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// scanFile integration — opt-out flag flows through (AC-6)
// ---------------------------------------------------------------------------

test('scanFile: forwards multilineCapture=false through extractTags', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f094-'));
  try {
    const file = path.join(tmp, 'src.js');
    fs.writeFileSync(file, [
      '// @cap-decision Foo',
      '//   bar',
    ].join('\n'));
    const tagsOff = scanFile(file, tmp, { multilineCapture: false });
    assert.strictEqual(tagsOff[0].description, 'Foo');
    const tagsOn = scanFile(file, tmp, { multilineCapture: true });
    assert.match(tagsOn[0].description, /bar/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// AC-7 — pinned regression: F-001 single-line behaviour unchanged
// ---------------------------------------------------------------------------

test('AC-7 regression: single-line description identical to pre-F-094 (no continuation context)', () => {
  // No continuation lines → description must be exactly the trimmed match[3]
  const content = '// @cap-decision Stable single-line decision\n';
  const tags = extractTags(content, 'a.js');
  assert.strictEqual(tags[0].description, 'Stable single-line decision');
});

test('AC-7 regression: tag followed by blank line — no continuation', () => {
  const content = [
    '// @cap-decision First',
    '',
    '//   would-be-continuation but blank line breaks it',
  ].join('\n');
  const tags = extractTags(content, 'a.js');
  assert.strictEqual(tags[0].description, 'First');
});
