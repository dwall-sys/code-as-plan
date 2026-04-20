'use strict';

// @cap-feature(feature:F-046) Test suite for the polylingual tag scanner extension.
// @cap-decision Tests live in a separate file to satisfy F-046/AC-5 — existing tests in cap-tag-scanner.test.cjs remain untouched.

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  COMMENT_STYLES,
  COMMENT_STYLES_DEFAULT,
  getCommentStyle,
  classifyTagContext,
  extractTagsWithContext,
  scanFileWithContext,
  scanDirectoryWithContext,
  // Legacy exports referenced for AC-5 compatibility checks.
  extractTags,
} = require('../cap/bin/lib/cap-tag-scanner.cjs');

const POLYGLOT_FIXTURE_DIR = path.join(__dirname, 'fixtures', 'polyglot');

// =====================================================================
// COMMENT_STYLES table
// =====================================================================

describe('F-046 COMMENT_STYLES table', () => {
  // @cap-todo(ac:F-046/AC-1) Verify every required language has an entry.
  const REQUIRED_LANGS = [
    '.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx',
    '.py', '.rb', '.sh', '.bash', '.zsh',
    '.go', '.rs',
    '.html', '.htm', '.css', '.scss', '.md',
  ];

  for (const ext of REQUIRED_LANGS) {
    it(`has a COMMENT_STYLES entry for ${ext}`, () => {
      assert.ok(COMMENT_STYLES[ext], `missing entry for ${ext}`);
      assert.ok(Array.isArray(COMMENT_STYLES[ext].line));
      assert.ok(Array.isArray(COMMENT_STYLES[ext].block));
    });
  }

  it('Python supports both """ and \'\'\' as block delimiters', () => {
    const py = COMMENT_STYLES['.py'];
    assert.deepStrictEqual(py.line, ['#']);
    const blockOpens = py.block.map(b => b[0]);
    assert.ok(blockOpens.includes('"""'));
    assert.ok(blockOpens.includes("'''"));
  });

  it('Ruby supports =begin/=end as a block delimiter', () => {
    const rb = COMMENT_STYLES['.rb'];
    assert.deepStrictEqual(rb.line, ['#']);
    assert.deepStrictEqual(rb.block, [['=begin', '=end']]);
  });

  it('Rust lists /// before // so /// is matched first', () => {
    const rs = COMMENT_STYLES['.rs'];
    assert.strictEqual(rs.line[0], '///');
    assert.ok(rs.line.includes('//'));
    assert.deepStrictEqual(rs.block, [['/*', '*/']]);
  });

  it('HTML and Markdown share <!-- --> block syntax with no line comments', () => {
    assert.deepStrictEqual(COMMENT_STYLES['.html'].line, []);
    assert.deepStrictEqual(COMMENT_STYLES['.html'].block, [['<!--', '-->']]);
    assert.deepStrictEqual(COMMENT_STYLES['.md'].block, [['<!--', '-->']]);
  });

  it('CSS has block-only comments while SCSS adds line comments', () => {
    assert.deepStrictEqual(COMMENT_STYLES['.css'].line, []);
    assert.deepStrictEqual(COMMENT_STYLES['.scss'].line, ['//']);
  });

  it('Shell family files have line-only comments (no block syntax)', () => {
    for (const ext of ['.sh', '.bash', '.zsh']) {
      assert.deepStrictEqual(COMMENT_STYLES[ext].line, ['#'], ext);
      assert.deepStrictEqual(COMMENT_STYLES[ext].block, [], ext);
    }
  });
});

// =====================================================================
// getCommentStyle()
// =====================================================================

describe('F-046 getCommentStyle', () => {
  it('returns the right style for known extensions', () => {
    assert.strictEqual(getCommentStyle('foo.py').line[0], '#');
    assert.strictEqual(getCommentStyle('foo.go').line[0], '//');
    assert.strictEqual(getCommentStyle('foo.html').block[0][0], '<!--');
  });

  it('is case-insensitive on extension', () => {
    assert.strictEqual(getCommentStyle('FOO.PY').line[0], '#');
    assert.strictEqual(getCommentStyle('Foo.Js').line[0], '//');
  });

  it('falls back to COMMENT_STYLES_DEFAULT for unknown extensions', () => {
    const style = getCommentStyle('foo.unknownext');
    assert.deepStrictEqual(style, COMMENT_STYLES_DEFAULT);
  });

  it('handles empty / missing extensions safely', () => {
    const style = getCommentStyle('Makefile');
    assert.ok(style);
    assert.ok(Array.isArray(style.line));
  });
});

// =====================================================================
// classifyTagContext()
// =====================================================================

describe('F-046 classifyTagContext', () => {
  it('classifies a tag inside a JS line comment as comment', () => {
    const line = '// @cap-feature(feature:F-046) hello';
    const result = classifyTagContext(getCommentStyle('a.js'), line, line.indexOf('@cap-feature'), { open: null });
    assert.strictEqual(result.context, 'comment');
  });

  it('classifies a tag inside a Python # comment as comment', () => {
    const line = '# @cap-feature(feature:F-046) py';
    const result = classifyTagContext(getCommentStyle('a.py'), line, line.indexOf('@cap-feature'), { open: null });
    assert.strictEqual(result.context, 'comment');
  });

  it('classifies a tag inside a JS string literal as code (would warn)', () => {
    const line = 'const x = "@cap-feature(feature:F-001) not a tag";';
    const result = classifyTagContext(getCommentStyle('a.js'), line, line.indexOf('@cap-feature'), { open: null });
    assert.strictEqual(result.context, 'code');
  });

  it('classifies a tag inside a JS block comment on the same line as comment', () => {
    const line = '/* @cap-feature(feature:F-046) inline */';
    const result = classifyTagContext(getCommentStyle('a.js'), line, line.indexOf('@cap-feature'), { open: null });
    assert.strictEqual(result.context, 'comment');
  });

  it('classifies a tag carried over from a previous line block as comment when block stays open', () => {
    const line = '@cap-feature(feature:F-046) inside an open block';
    const state = { open: ['/*', '*/'] };
    const result = classifyTagContext(getCommentStyle('a.js'), line, line.indexOf('@cap-feature'), state);
    assert.strictEqual(result.context, 'comment');
  });

  it('handles HTML <!-- --> open across lines', () => {
    const line = '@cap-feature(feature:F-046) inside HTML comment';
    const state = { open: ['<!--', '-->'] };
    const result = classifyTagContext(getCommentStyle('a.html'), line, line.indexOf('@cap-feature'), state);
    assert.strictEqual(result.context, 'comment');
  });

  it('classifies a tag past the close of a same-line block as code', () => {
    const line = '/* short */ const x = "@cap-feature(feature:F-001) wrong";';
    const result = classifyTagContext(getCommentStyle('a.js'), line, line.indexOf('@cap-feature'), { open: null });
    assert.strictEqual(result.context, 'code');
  });

  it('returns a non-empty reason string', () => {
    const line = '// @cap-feature(feature:F-046)';
    const result = classifyTagContext(getCommentStyle('a.js'), line, line.indexOf('@cap-feature'), { open: null });
    assert.ok(result.reason && result.reason.length > 0);
  });

  it('does not falsely classify Rust /// when /// appears later in code', () => {
    // Tag at column 0 inside ///, but cursor is at column 0 — tag IS in a doc-comment.
    const line = '/// @cap-feature(feature:F-046) doc comment';
    const result = classifyTagContext(getCommentStyle('a.rs'), line, line.indexOf('@cap-feature'), { open: null });
    assert.strictEqual(result.context, 'comment');
    assert.match(result.reason, /\/\/\//);
  });
});

// =====================================================================
// extractTagsWithContext() — string literal exclusion (AC-3)
// =====================================================================

describe('F-046 extractTagsWithContext — string literal exclusion (AC-3)', () => {
  it('does not parse @cap-* inside a Python string literal as a tag', () => {
    const content = `def foo():\n    return "@cap-feature(feature:F-999) not a tag"\n`;
    const result = extractTagsWithContext(content, 'foo.py');
    assert.strictEqual(result.tags.length, 0);
    assert.strictEqual(result.warnings.length, 1);
    // After F-046/AC-3 string-state extension, warning explicitly identifies the string literal context.
    assert.match(result.warnings[0].reason, /string literal/);
    assert.strictEqual(result.warnings[0].line, 2);
  });

  it('does not parse @cap-* inside a JS string literal as a tag', () => {
    const content = `const msg = "@cap-feature(feature:F-001) fake";\n`;
    const result = extractTagsWithContext(content, 'foo.js');
    assert.strictEqual(result.tags.length, 0);
    assert.strictEqual(result.warnings.length, 1);
  });

  it('parses a @cap-* in a comment AND warns on a sibling @cap-* in code on the next line', () => {
    const content = '// @cap-feature(feature:F-046) real\nconst x = "@cap-feature(feature:F-046) fake";\n';
    const result = extractTagsWithContext(content, 'foo.js');
    assert.strictEqual(result.tags.length, 1);
    assert.strictEqual(result.warnings.length, 1);
    assert.strictEqual(result.tags[0].line, 1);
    assert.strictEqual(result.warnings[0].line, 2);
  });

  it('warning records include file, line, column, reason, raw', () => {
    const content = `const x = "@cap-feature(feature:F-001) fake";`;
    const result = extractTagsWithContext(content, 'foo.js');
    const w = result.warnings[0];
    assert.ok(typeof w.file === 'string');
    assert.ok(typeof w.line === 'number');
    assert.ok(typeof w.column === 'number');
    assert.ok(typeof w.reason === 'string');
    assert.ok(typeof w.raw === 'string');
  });
});

// =====================================================================
// extractTagsWithContext() — language coverage (AC-1, AC-2)
// =====================================================================

describe('F-046 extractTagsWithContext — per-language parsing (AC-1)', () => {
  it('parses Python # line comments', () => {
    const content = `# @cap-feature(feature:F-046) py\n`;
    const r = extractTagsWithContext(content, 'a.py');
    assert.strictEqual(r.tags.length, 1);
    assert.strictEqual(r.tags[0].type, 'feature');
  });

  it('parses Python triple-quote block comments across multiple lines', () => {
    const content = `"""\n@cap-todo(ac:F-046/AC-1) inside docstring\n@cap-decision multi-line\n"""\n`;
    const r = extractTagsWithContext(content, 'a.py');
    assert.strictEqual(r.tags.length, 2);
    assert.strictEqual(r.warnings.length, 0);
  });

  it('parses Ruby # line comments', () => {
    const r = extractTagsWithContext(`# @cap-risk(feature:F-046) rb\n`, 'a.rb');
    assert.strictEqual(r.tags.length, 1);
    assert.strictEqual(r.tags[0].type, 'risk');
  });

  it('parses Ruby =begin/=end block comments', () => {
    const content = `=begin\n@cap-todo(ac:F-046/AC-1) ruby block\n=end\n`;
    const r = extractTagsWithContext(content, 'a.rb');
    assert.strictEqual(r.tags.length, 1);
  });

  it('parses Shell # line comments', () => {
    const r = extractTagsWithContext(`# @cap-todo(ac:F-046/AC-1) sh\n`, 'a.sh');
    assert.strictEqual(r.tags.length, 1);
  });

  it('parses Go // and /* */ comments', () => {
    const content = `// @cap-feature(feature:F-046) go\n/* @cap-todo(ac:F-046/AC-1) inline */\n`;
    const r = extractTagsWithContext(content, 'a.go');
    assert.strictEqual(r.tags.length, 2);
  });

  it('parses Rust ///, //, and /* */ comments', () => {
    const content = `/// @cap-feature(feature:F-046) doc\n// @cap-risk plain\n/* @cap-decision block */\n`;
    const r = extractTagsWithContext(content, 'a.rs');
    assert.strictEqual(r.tags.length, 3);
  });

  it('parses HTML <!-- --> single-line comments', () => {
    const r = extractTagsWithContext(`<!-- @cap-feature(feature:F-046) html -->\n`, 'a.html');
    assert.strictEqual(r.tags.length, 1);
  });

  it('parses HTML <!-- --> multi-line comments', () => {
    const content = `<!--\n@cap-todo(ac:F-046/AC-1) html multi\n@cap-decision multi-line\n-->\n`;
    const r = extractTagsWithContext(content, 'a.html');
    assert.strictEqual(r.tags.length, 2);
  });

  it('parses CSS /* */ comments', () => {
    const r = extractTagsWithContext(`/* @cap-feature(feature:F-046) css */\n`, 'a.css');
    assert.strictEqual(r.tags.length, 1);
  });

  it('parses Markdown <!-- --> comments', () => {
    const r = extractTagsWithContext(`<!-- @cap-feature(feature:F-046) md -->\n`, 'a.md');
    assert.strictEqual(r.tags.length, 1);
  });
});

// =====================================================================
// extractTagsWithContext() — metadata + subtype extraction parity
// =====================================================================

describe('F-046 extractTagsWithContext — metadata parity', () => {
  it('parses metadata key:value pairs identically to legacy extractTags', () => {
    const content = `// @cap-feature(feature:F-046, primary:true) hello\n`;
    const r = extractTagsWithContext(content, 'a.js');
    assert.strictEqual(r.tags[0].metadata.feature, 'F-046');
    assert.strictEqual(r.tags[0].metadata.primary, 'true');
  });

  it('detects @cap-todo subtype prefix (risk:)', () => {
    const content = `# @cap-todo risk: leaks under load\n`;
    const r = extractTagsWithContext(content, 'a.py');
    assert.strictEqual(r.tags[0].type, 'todo');
    assert.strictEqual(r.tags[0].subtype, 'risk');
  });

  it('detects @cap-todo subtype prefix (decision:)', () => {
    const content = `// @cap-todo decision: chose bcrypt\n`;
    const r = extractTagsWithContext(content, 'a.js');
    assert.strictEqual(r.tags[0].subtype, 'decision');
  });

  it('records 1-based line numbers', () => {
    const content = `\n\n# @cap-feature(feature:F-046) on line 3\n`;
    const r = extractTagsWithContext(content, 'a.py');
    assert.strictEqual(r.tags[0].line, 3);
  });
});

// =====================================================================
// scanDirectoryWithContext() against polyglot fixtures (AC-2)
// =====================================================================

describe('F-046 scanDirectoryWithContext — polyglot fixtures (AC-2)', () => {
  it('finds tags in every supported polyglot fixture file', () => {
    const result = scanDirectoryWithContext(POLYGLOT_FIXTURE_DIR);
    const fileExts = new Set(result.tags.map(t => path.extname(t.file)));
    // Every supported language fixture contributes at least one tag.
    for (const ext of ['.py', '.rb', '.sh', '.go', '.rs', '.html', '.css']) {
      assert.ok(fileExts.has(ext), `expected at least one tag from ${ext}`);
    }
  });

  it('finds at least one of each tag type across the fixture set', () => {
    const result = scanDirectoryWithContext(POLYGLOT_FIXTURE_DIR);
    const types = new Set(result.tags.map(t => t.type));
    for (const t of ['feature', 'todo', 'risk', 'decision']) {
      assert.ok(types.has(t), `expected at least one @cap-${t} across fixtures`);
    }
  });

  it('emits warnings for the string-literal fixture', () => {
    const result = scanDirectoryWithContext(POLYGLOT_FIXTURE_DIR);
    const stringFileWarnings = result.warnings.filter(w => w.file.endsWith('example_string_literal.py'));
    assert.ok(stringFileWarnings.length >= 2, `expected warnings from string-literal fixture, got ${stringFileWarnings.length}`);
  });

  it('does NOT emit a tag for the @cap-* tokens inside Python strings', () => {
    const result = scanDirectoryWithContext(POLYGLOT_FIXTURE_DIR);
    const stringFileTags = result.tags.filter(t => t.file.endsWith('example_string_literal.py'));
    // Only the real # @cap-feature(feature:F-046) at the top should be parsed (1 tag, plus the in-comment line "# Real comment...").
    // The fake tags in `return "..."` and `msg = '...'` must not appear.
    for (const t of stringFileTags) {
      assert.notStrictEqual(t.metadata.feature, 'F-999', 'tag from inside a string was incorrectly parsed');
    }
  });

  it('returns the expected total tag count from polyglot fixtures (regression sentinel)', () => {
    const result = scanDirectoryWithContext(POLYGLOT_FIXTURE_DIR);
    // Sentinel: when fixtures evolve, update this number deliberately.
    assert.ok(result.tags.length >= 30, `expected at least 30 tags across polyglot fixtures, got ${result.tags.length}`);
  });
});

// =====================================================================
// --strict mode (AC-4)
// =====================================================================

describe('F-046 scanDirectoryWithContext --strict mode (AC-4)', () => {
  it('does not throw when no warnings are present', () => {
    // Build a tiny clean fixture in tmpdir.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-strict-clean-'));
    try {
      fs.writeFileSync(path.join(tmp, 'a.py'), `# @cap-feature(feature:F-046) ok\n`);
      const result = scanDirectoryWithContext(tmp, { strict: true });
      assert.strictEqual(result.warnings.length, 0);
      assert.strictEqual(result.tags.length, 1);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('throws CAP_STRICT_TAG_VIOLATION when a tag is found outside a comment', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-strict-violation-'));
    try {
      fs.writeFileSync(path.join(tmp, 'a.js'), `const x = "@cap-feature(feature:F-001) fake";\n`);
      let err = null;
      try {
        scanDirectoryWithContext(tmp, { strict: true });
      } catch (e) {
        err = e;
      }
      assert.ok(err, 'expected --strict to throw');
      assert.strictEqual(err.code, 'CAP_STRICT_TAG_VIOLATION');
      assert.ok(Array.isArray(err.warnings));
      assert.ok(err.warnings.length >= 1);
      assert.match(err.message, /outside comment context/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('does NOT throw in non-strict mode even when warnings are present', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-strict-off-'));
    try {
      fs.writeFileSync(path.join(tmp, 'a.js'), `const x = "@cap-feature(feature:F-001) fake";\n`);
      const result = scanDirectoryWithContext(tmp); // no strict flag
      assert.ok(result.warnings.length >= 1);
      assert.strictEqual(result.tags.length, 0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('strict mode error message lists at most 5 individual warnings + summary count', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-strict-many-'));
    try {
      // 8 violations spread across 2 files.
      const lines = Array.from({ length: 8 }, (_, i) => `const x${i} = "@cap-feature(feature:F-046) v${i}";`).join('\n');
      fs.writeFileSync(path.join(tmp, 'a.js'), lines + '\n');
      let err = null;
      try {
        scanDirectoryWithContext(tmp, { strict: true });
      } catch (e) { err = e; }
      assert.ok(err);
      assert.strictEqual(err.warnings.length, 8);
      assert.match(err.message, /and 3 more/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// =====================================================================
// scanFileWithContext() basic shape
// =====================================================================

describe('F-046 scanFileWithContext', () => {
  it('returns {tags, warnings} for a real file', () => {
    const result = scanFileWithContext(path.join(POLYGLOT_FIXTURE_DIR, 'example.py'), POLYGLOT_FIXTURE_DIR);
    assert.ok(Array.isArray(result.tags));
    assert.ok(Array.isArray(result.warnings));
    assert.ok(result.tags.length > 0);
  });

  it('returns empty arrays for a missing file', () => {
    const result = scanFileWithContext('/does/not/exist.py', '/does/not');
    assert.deepStrictEqual(result, { tags: [], warnings: [] });
  });

  it('writes paths relative to projectRoot', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-rel-'));
    try {
      const sub = path.join(tmp, 'sub');
      fs.mkdirSync(sub);
      const file = path.join(sub, 'a.py');
      fs.writeFileSync(file, `# @cap-feature(feature:F-046) hi\n`);
      const result = scanFileWithContext(file, tmp);
      assert.strictEqual(result.tags[0].file, path.join('sub', 'a.py'));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// =====================================================================
// AC-5: Backward compatibility — legacy extractTags unchanged
// =====================================================================

describe('F-046 AC-5 backward compatibility', () => {
  it('legacy extractTags returns CapTag[] (NOT {tags, warnings}) for JS', () => {
    const content = `// @cap-feature(feature:F-046) js\n`;
    const result = extractTags(content, 'a.js');
    assert.ok(Array.isArray(result), 'extractTags must still return an array');
    assert.strictEqual(result[0].type, 'feature');
  });

  it('legacy extractTags ignores @cap-* inside string literals (regex-anchored to comment tokens)', () => {
    const content = `const x = "@cap-feature(feature:F-001) fake";\n`;
    const result = extractTags(content, 'a.js');
    assert.strictEqual(result.length, 0);
  });

  it('legacy extractTags signature matches its historical (content, filePath) -> array shape', () => {
    assert.strictEqual(typeof extractTags, 'function');
    assert.strictEqual(extractTags.length, 2);
  });
});
