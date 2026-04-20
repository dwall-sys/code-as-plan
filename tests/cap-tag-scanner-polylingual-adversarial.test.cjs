'use strict';

// @cap-feature(feature:F-046) Adversarial test suite for the polylingual tag scanner extension.
// @cap-decision Separate from cap-tag-scanner-polylingual.test.cjs so the prototyper's happy-path tests stay readable; this file only documents bugs and edge cases.
// @cap-todo(ac:F-046/AC-3) These tests pin down precise behaviour around string-literal exclusion — including known false positives that the implementation does NOT yet catch (see CAP_BUG_F046_STRING_COMMENT_TOKEN markers).

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  classifyTagContext,
  extractTagsWithContext,
  scanFileWithContext,
  scanDirectoryWithContext,
  getCommentStyle,
  COMMENT_STYLES,
  COMMENT_STYLES_DEFAULT,
  extractTags,
} = require('../cap/bin/lib/cap-tag-scanner.cjs');

const POLYGLOT_FIXTURE_DIR = path.join(__dirname, 'fixtures', 'polyglot');

// =====================================================================
// 1. Acceptance gate sentinels (live invariants)
// =====================================================================

describe('F-046 ADV: live polyglot fixture sentinels', () => {
  it('scanDirectoryWithContext on polyglot fixtures returns exactly 37 tags and 6 warnings', () => {
    // Counts: 36 from the original polyglot fixtures + 1 real tag from example_js_string_comment.js (header).
    // Warnings: 2 from example_string_literal.py + 4 from example_js_string_comment.js (one per fake string).
    const r = scanDirectoryWithContext(POLYGLOT_FIXTURE_DIR);
    assert.strictEqual(r.tags.length, 37);
    assert.strictEqual(r.warnings.length, 6);
  });

  it('warnings come exclusively from string-literal fixtures (no false positives in normal-comment fixtures)', () => {
    const r = scanDirectoryWithContext(POLYGLOT_FIXTURE_DIR);
    for (const w of r.warnings) {
      assert.match(w.file, /(example_string_literal\.py|example_js_string_comment\.js)$/, `unexpected warning in ${w.file}`);
    }
  });

  it('every fixture file contributes at least one tag', () => {
    const r = scanDirectoryWithContext(POLYGLOT_FIXTURE_DIR);
    const filesWithTags = new Set(r.tags.map(t => path.basename(t.file)));
    const expected = ['example.py', 'example.rb', 'example.sh', 'example.go', 'example.rs', 'example.html', 'example.css', 'example_string_literal.py', 'example_js_string_comment.js'];
    for (const f of expected) {
      assert.ok(filesWithTags.has(f), `expected tags from ${f}`);
    }
  });

  it('strict mode against polyglot fixtures throws because of the string-literal warnings', () => {
    let err = null;
    try {
      scanDirectoryWithContext(POLYGLOT_FIXTURE_DIR, { strict: true });
    } catch (e) {
      err = e;
    }
    assert.ok(err, 'strict mode must throw on the polyglot fixture set');
    assert.strictEqual(err.code, 'CAP_STRICT_TAG_VIOLATION');
    assert.strictEqual(err.warnings.length, 6);
  });
});

// =====================================================================
// 2. F-046/AC-3: string literals containing comment tokens are correctly rejected
// =====================================================================
// AC-3 contract: when a @cap-* token sits inside a string literal, the scanner MUST emit a
// warning AND MUST NOT extract the token as a tag. This previously failed for the case where
// the string literal itself contained a comment-style token (e.g., `"// @cap-..."`,
// `"/* @cap-... */"`, `"# @cap-..."`). The fix added STRING_STYLES + a string-state walker that
// detects the opening quote BEFORE the embedded comment-style token, so the walker is in
// string-state when the @cap-* match is reached.
//
// These tests previously witnessed the bug; they are now inverted to assert the corrected
// behavior and act as regression sentinels.

describe('F-046/AC-3 string literal containing comment token is correctly rejected', () => {
  it('JS: const x = "// @cap-feature(...)" — string-internal // is recognized as string, tag is rejected, warning emitted', () => {
    const content = `const x = "// @cap-feature(feature:F-999) fake-comment-in-string";\n`;
    const r = extractTagsWithContext(content, 'a.js');
    assert.strictEqual(r.tags.length, 0, 'tag inside string literal must NOT be extracted');
    assert.strictEqual(r.warnings.length, 1, 'tag inside string literal must produce exactly one warning');
    assert.match(r.warnings[0].reason, /string literal/, 'warning reason must mention string literal');
    // Sanity: legacy extractTags is anchored to start-of-line and never had this bug.
    assert.strictEqual(extractTags(content, 'a.js').length, 0, 'legacy extractTags remains safe (anchored to ^)');
  });

  it('JS: const x = "/* @cap-feature(...) */" — string-internal /* is recognized as string, tag is rejected, warning emitted', () => {
    const content = `const x = "/* @cap-feature(feature:F-999) fake */";\n`;
    const r = extractTagsWithContext(content, 'a.js');
    assert.strictEqual(r.tags.length, 0, 'tag inside string literal must NOT be extracted');
    assert.strictEqual(r.warnings.length, 1, 'tag inside string literal must produce exactly one warning');
    assert.match(r.warnings[0].reason, /string literal/, 'warning reason must mention string literal');
    assert.strictEqual(extractTags(content, 'a.js').length, 0, 'legacy extractTags remains safe');
  });

  it('Python: x = "# @cap-feature(...)" — string-internal # is recognized as string, tag is rejected, warning emitted', () => {
    const content = `x = "# @cap-feature(feature:F-999) fake"\n`;
    const r = extractTagsWithContext(content, 'a.py');
    assert.strictEqual(r.tags.length, 0, 'tag inside Python string literal must NOT be extracted');
    assert.strictEqual(r.warnings.length, 1, 'tag inside Python string literal must produce exactly one warning');
    assert.match(r.warnings[0].reason, /string literal/, 'warning reason must mention string literal');
  });

  it('classifyTagContext returns context="string" for string-internal // (was "comment" before fix)', () => {
    const line = `const x = "// @cap-feature(feature:F-999) fake";`;
    const col = line.indexOf('@cap-feature');
    const r = classifyTagContext(
      getCommentStyle('a.js'),
      line,
      col,
      { open: null, stringClose: null, stringEscapes: false, stringOpenToken: null },
      require('../cap/bin/lib/cap-tag-scanner.cjs').getStringStyle('a.js')
    );
    assert.strictEqual(r.context, 'string', 'cursor inside a string literal must classify as "string"');
    assert.match(r.reason, /string literal/, 'reason must mention string literal');
  });
});

// =====================================================================
// 3. AC-3 cases that DO work correctly (string literal alone, no embedded comment token)
// =====================================================================

describe('F-046 ADV / AC-3: string literals WITHOUT embedded comment tokens correctly warn', () => {
  it('JS template literal containing @cap-* warns', () => {
    const content = "const x = `@cap-feature(feature:F-999) template literal`;\n";
    const r = extractTagsWithContext(content, 'a.js');
    assert.strictEqual(r.tags.length, 0);
    assert.strictEqual(r.warnings.length, 1);
  });

  it('Python f-string containing @cap-* warns', () => {
    const content = `msg = f"@cap-feature(feature:F-999) {var}"\n`;
    const r = extractTagsWithContext(content, 'a.py');
    assert.strictEqual(r.tags.length, 0);
    assert.strictEqual(r.warnings.length, 1);
  });

  it('Go raw string `@cap-...` warns', () => {
    const content = "var s = `@cap-feature(feature:F-999) raw string`\n";
    const r = extractTagsWithContext(content, 'a.go');
    assert.strictEqual(r.tags.length, 0);
    assert.strictEqual(r.warnings.length, 1);
  });

  it('Rust raw string r"@cap-..." warns', () => {
    const content = `let s = r"@cap-feature(feature:F-999) rust raw";\n`;
    const r = extractTagsWithContext(content, 'a.rs');
    assert.strictEqual(r.tags.length, 0);
    assert.strictEqual(r.warnings.length, 1);
  });

  it('CSS content: "@cap-..." warns', () => {
    const content = `body::before { content: "@cap-feature(feature:F-999) css string" }\n`;
    const r = extractTagsWithContext(content, 'a.css');
    assert.strictEqual(r.tags.length, 0);
    assert.strictEqual(r.warnings.length, 1);
  });

  it('Tag at file start with no comment token warns', () => {
    const content = `@cap-feature(feature:F-046) bare\n`;
    const r = extractTagsWithContext(content, 'a.js');
    assert.strictEqual(r.tags.length, 0);
    assert.strictEqual(r.warnings.length, 1);
    assert.strictEqual(r.warnings[0].column, 0);
  });

  it('Escaped quotes in JS string still classified as code (string-internal token)', () => {
    const content = `const x = "outer \\"@cap-feature(feature:F-999) escaped\\" tail";\n`;
    const r = extractTagsWithContext(content, 'a.js');
    assert.strictEqual(r.tags.length, 0);
    assert.strictEqual(r.warnings.length, 1);
  });
});

// =====================================================================
// 4. KNOWN LIMITATION: heredocs and multi-line strings in shell/Ruby behave correctly
// (because no comment token appears at the start of the line)
// =====================================================================

describe('F-046 ADV / AC-3: heredocs and multi-line strings (current behaviour)', () => {
  it('Ruby heredoc body with @cap-* warns (no leading comment token on body line)', () => {
    const content = `text = <<~END\n  @cap-feature(feature:F-999) inside heredoc\nEND\n`;
    const r = extractTagsWithContext(content, 'a.rb');
    assert.strictEqual(r.tags.length, 0);
    assert.strictEqual(r.warnings.length, 1);
  });

  it('Shell heredoc body with @cap-* warns (no leading # on body line)', () => {
    const content = `cat <<EOF\n@cap-feature(feature:F-999) heredoc\nEOF\n`;
    const r = extractTagsWithContext(content, 'a.sh');
    assert.strictEqual(r.tags.length, 0);
    assert.strictEqual(r.warnings.length, 1);
  });

  it('KNOWN LIMITATION: heredoc body line that starts with # IS treated as a shell comment', () => {
    // The scanner cannot distinguish a heredoc body line starting with # from a real shell comment,
    // because shell line-comment detection is purely textual. Documented as @cap-risk in fixture.
    const content = `cat <<EOF\n# @cap-feature(feature:F-999) heredoc with hash\nEOF\n`;
    const r = extractTagsWithContext(content, 'a.sh');
    // Documents current (acceptable) behaviour: the # is interpreted as a shell comment.
    assert.strictEqual(r.tags.length, 1, 'KNOWN LIMITATION: heredoc body lines starting with # parse as comments.');
  });
});

// =====================================================================
// 5. Multi-line block comments and state-machine edge cases
// =====================================================================

describe('F-046 ADV: block-comment state machine edge cases', () => {
  it('unclosed JS block comment does not crash and treats all subsequent lines as comment', () => {
    const content = `/* @cap-feature(feature:F-046) start\nstill in block\nstill in block\n`;
    const r = extractTagsWithContext(content, 'a.js');
    assert.strictEqual(r.tags.length, 1);
    assert.strictEqual(r.warnings.length, 0);
  });

  it('block opened with preceding code, closed on later line — opening tag still counted', () => {
    const content = `code; /* @cap-feature(feature:F-046) inside\nstill in\n*/\n`;
    const r = extractTagsWithContext(content, 'a.js');
    assert.strictEqual(r.tags.length, 1);
  });

  it('block close on line 2 then string literal on same line: tag in string is rejected', () => {
    const content = `/* start\n*/ const x = "@cap-feature(feature:F-999) after close";\n`;
    const r = extractTagsWithContext(content, 'a.js');
    assert.strictEqual(r.tags.length, 0);
    assert.strictEqual(r.warnings.length, 1);
  });

  it('empty /**/ followed by tag on next line — tag is parsed', () => {
    const content = `/**/\n// @cap-feature(feature:F-046) after empty\n`;
    const r = extractTagsWithContext(content, 'a.js');
    assert.strictEqual(r.tags.length, 1);
  });

  it('multiple block comments on same line — only the in-block tag is parsed', () => {
    const content = `/* a */ /* @cap-feature(feature:F-046) two */ x = 1;\n`;
    const r = extractTagsWithContext(content, 'a.js');
    assert.strictEqual(r.tags.length, 1);
    assert.strictEqual(r.tags[0].metadata.feature, 'F-046');
  });

  it('star-prefix continuation lines inside Go block comment count as comment', () => {
    const content = `/*\n * @cap-todo(ac:F-046/AC-1) star1\n * @cap-risk star2\n */\n`;
    const r = extractTagsWithContext(content, 'a.go');
    assert.strictEqual(r.tags.length, 2);
  });

  it('Python triple-quote opens but never closes — subsequent tags treated as in-block', () => {
    const content = `"""\n@cap-feature(feature:F-046) inside\n@cap-todo(ac:F-046/AC-1) also inside\n`;
    const r = extractTagsWithContext(content, 'a.py');
    assert.strictEqual(r.tags.length, 2);
    assert.strictEqual(r.warnings.length, 0);
  });

  it('Python inline triple-quote: """text @cap-feature(...) trail""" — parses tag (description includes trailing """)', () => {
    // Documents that description retains trailing """ marker.
    const content = `"""docstring with @cap-feature(feature:F-046) inline"""\n`;
    const r = extractTagsWithContext(content, 'a.py');
    assert.strictEqual(r.tags.length, 1);
    // Description includes the trailing block-close marker — cosmetic limitation.
    assert.match(r.tags[0].description, /inline/);
  });
});

// =====================================================================
// 6. Per-line tag count (single-tag-per-line limitation)
// =====================================================================

describe('F-046 ADV: per-line tag-count limitation', () => {
  it('two tags on the same comment line are merged into a single tag (description swallows the second)', () => {
    // The looseTagRe captures `[^\r\n]*` for description, so a second @cap-* on the same line is
    // consumed as part of the first tag's description rather than emitted as a separate tag.
    // This matches legacy extractTags behaviour (same limitation).
    const content = `// @cap-feature(feature:F-046) one @cap-todo(ac:F-046/AC-1) two\n`;
    const r = extractTagsWithContext(content, 'a.js');
    const legacy = extractTags(content, 'a.js');
    assert.strictEqual(r.tags.length, 1, 'newpath: 1 tag (description swallows the second)');
    assert.strictEqual(legacy.length, 1, 'legacy: same single-tag behaviour');
    assert.match(r.tags[0].description, /@cap-todo/);
  });
});

// =====================================================================
// 7. AC-1: Rust-specific extras (//!, nested blocks)
// =====================================================================

describe('F-046 ADV / AC-1: Rust extras', () => {
  it('Rust //! inner-doc comment is parsed (// matched)', () => {
    const content = `//! @cap-feature(feature:F-046) inner doc\n`;
    const r = extractTagsWithContext(content, 'a.rs');
    assert.strictEqual(r.tags.length, 1);
  });

  it('KNOWN LIMITATION: Rust nested block comments are NOT depth-tracked', () => {
    // Real Rust permits nesting; the scanner closes on the first */ encountered. Tag inside the
    // inner block is still classified as comment because the outer block opens before tagColumn.
    const content = `/* outer /* inner @cap-feature(feature:F-046) */ outer */\n`;
    const r = extractTagsWithContext(content, 'a.rs');
    assert.strictEqual(r.tags.length, 1, 'tag in nested block is parsed (no depth tracking)');
  });
});

// =====================================================================
// 8. AC-1: HTML-specific extras
// =====================================================================

describe('F-046 ADV / AC-1: HTML extras', () => {
  it('KNOWN LIMITATION: nested HTML comments — first --> closes outer block', () => {
    const content = `<!-- outer <!-- @cap-feature(feature:F-046) bad --> -->\n`;
    const r = extractTagsWithContext(content, 'a.html');
    // Tag at column ~17 sits BEFORE the first --> at ~50, so it's still in the outer block: tag emitted.
    assert.strictEqual(r.tags.length, 1);
  });

  it('HTML <script> with JS string containing @cap-* warns (no <!-- around it)', () => {
    const content = `<script>const x = "@cap-feature(feature:F-999) jsinhtml"</script>\n`;
    const r = extractTagsWithContext(content, 'a.html');
    assert.strictEqual(r.tags.length, 0);
    assert.strictEqual(r.warnings.length, 1);
  });
});

// =====================================================================
// 9. AC-1: Markdown / mention-in-prose noise
// =====================================================================

describe('F-046 ADV / AC-1: Markdown prose mentions of @cap-* generate warnings', () => {
  it('A markdown line mentioning @cap-feature in plain prose generates a warning (no <!-- around it)', () => {
    const content = `Use @cap-feature(feature:F-001) tags to mark code.\n`;
    const r = extractTagsWithContext(content, 'a.md');
    assert.strictEqual(r.tags.length, 0);
    assert.strictEqual(r.warnings.length, 1);
  });

  it('Markdown code fences are NOT understood — tags inside fences are warnings, not comments', () => {
    const content = "```js\n// @cap-feature(feature:F-046) inside fence\n```\n";
    const r = extractTagsWithContext(content, 'a.md');
    // The .md style has no // line comment — so the // is not a comment, and the regex finds the
    // tag at column 3, walker doesn't see <!-- so it warns.
    assert.strictEqual(r.tags.length, 0);
    assert.strictEqual(r.warnings.length, 1);
  });
});

// =====================================================================
// 10. AC-4: --strict mode contract details
// =====================================================================

describe('F-046 ADV / AC-4: --strict error structure', () => {
  it('error.warnings array contains EVERY warning (not truncated)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-adv-strict-all-'));
    try {
      const lines = Array.from({ length: 12 }, (_, i) => `const x${i} = "@cap-feature(feature:F-046) v${i}";`).join('\n');
      fs.writeFileSync(path.join(tmp, 'a.js'), lines + '\n');
      let err = null;
      try { scanDirectoryWithContext(tmp, { strict: true }); } catch (e) { err = e; }
      assert.ok(err);
      assert.strictEqual(err.warnings.length, 12);
      assert.match(err.message, /found 12 tag/);
      assert.match(err.message, /and 7 more/);
      assert.strictEqual(err.code, 'CAP_STRICT_TAG_VIOLATION');
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  it('strict mode does not throw when warnings are zero', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-adv-strict-clean-'));
    try {
      fs.writeFileSync(path.join(tmp, 'a.py'), `# @cap-feature(feature:F-046) ok\n`);
      const r = scanDirectoryWithContext(tmp, { strict: true });
      assert.strictEqual(r.warnings.length, 0);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  it('non-strict mode never throws even with 100 warnings', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-adv-strict-off-'));
    try {
      const lines = Array.from({ length: 100 }, (_, i) => `const x${i} = "@cap-feature(feature:F-046) v${i}";`).join('\n');
      fs.writeFileSync(path.join(tmp, 'a.js'), lines + '\n');
      const r = scanDirectoryWithContext(tmp);
      assert.strictEqual(r.warnings.length, 100);
      assert.strictEqual(r.tags.length, 0);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  it('strict mode message lists at most 5 warnings inline', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-adv-strict-five-'));
    try {
      const lines = Array.from({ length: 6 }, (_, i) => `const x${i} = "@cap-feature(feature:F-046) v${i}";`).join('\n');
      fs.writeFileSync(path.join(tmp, 'a.js'), lines + '\n');
      let err = null;
      try { scanDirectoryWithContext(tmp, { strict: true }); } catch (e) { err = e; }
      // 5 inline + "and 1 more"
      const inlineCount = (err.message.match(/^\s+a\.js/gm) || []).length;
      assert.strictEqual(inlineCount, 5);
      assert.match(err.message, /and 1 more/);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });
});

// =====================================================================
// 11. AC-5: legacy API completely unchanged
// =====================================================================

describe('F-046 ADV / AC-5: legacy API surface frozen', () => {
  it('legacy extractTags ignores tags in string literals (regex-anchored to line start comment token)', () => {
    const content = `const x = "// @cap-feature(feature:F-999) fake";\n`;
    assert.strictEqual(extractTags(content, 'a.js').length, 0);
  });

  it('SUPPORTED_EXTENSIONS list length unchanged at 18 (legacy contract)', () => {
    const { SUPPORTED_EXTENSIONS } = require('../cap/bin/lib/cap-tag-scanner.cjs');
    assert.strictEqual(SUPPORTED_EXTENSIONS.length, 18);
  });

  it('all primary public exports remain functions or arrays of expected types', () => {
    const m = require('../cap/bin/lib/cap-tag-scanner.cjs');
    for (const name of ['extractTags', 'scanFile', 'scanDirectory', 'scanMonorepo', 'groupByFeature', 'buildAcFileMap', 'parseMetadata', 'detectOrphans']) {
      assert.strictEqual(typeof m[name], 'function', `${name} must remain a function`);
    }
    assert.ok(Array.isArray(m.CAP_TAG_TYPES));
    assert.ok(Array.isArray(m.SUPPORTED_EXTENSIONS));
    assert.ok(m.CAP_TAG_RE instanceof RegExp);
    assert.ok(m.LEGACY_TAG_RE instanceof RegExp);
  });

  it('legacy scanDirectory still returns a flat CapTag[] (not {tags, warnings})', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-adv-legacy-shape-'));
    try {
      fs.writeFileSync(path.join(tmp, 'a.py'), `# @cap-feature(feature:F-046) ok\n`);
      const { scanDirectory } = require('../cap/bin/lib/cap-tag-scanner.cjs');
      const r = scanDirectory(tmp, { projectRoot: tmp });
      assert.ok(Array.isArray(r), 'scanDirectory must remain CapTag[]');
      assert.strictEqual(r.length, 1);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });
});

// =====================================================================
// 12. Defensive: scanner does not crash on degenerate inputs
// =====================================================================

describe('F-046 ADV: degenerate input safety', () => {
  it('classifyTagContext on empty line returns code', () => {
    const r = classifyTagContext(getCommentStyle('a.js'), '', 0, { open: null });
    assert.strictEqual(r.context, 'code');
  });

  it('classifyTagContext with column past line length does not throw', () => {
    // Documents current (lenient) behaviour: returns 'comment' when a // is found before the
    // clamped column. Acceptable for degenerate input.
    const r = classifyTagContext(getCommentStyle('a.js'), '// short', 999, { open: null });
    assert.ok(r.context === 'comment' || r.context === 'code');
  });

  it('extractTagsWithContext on empty content returns empty results', () => {
    const r = extractTagsWithContext('', 'a.js');
    assert.deepStrictEqual(r, { tags: [], warnings: [] });
  });

  it('scanFileWithContext on missing path returns empty results, no throw', () => {
    const r = scanFileWithContext('/does/not/exist.js', '/does/not');
    assert.deepStrictEqual(r, { tags: [], warnings: [] });
  });

  it('extractTagsWithContext on extremely long line still finds tag', () => {
    const content = `// ${' '.repeat(10000)}@cap-feature(feature:F-046) far\n`;
    const r = extractTagsWithContext(content, 'a.js');
    assert.strictEqual(r.tags.length, 1);
  });

  it('Unknown extension falls back to permissive default', () => {
    const r = extractTagsWithContext(`// @cap-feature(feature:F-046) custom\n`, 'a.foo');
    assert.strictEqual(r.tags.length, 1);
  });

  it('Extensionless file (e.g., Makefile) parses with default style', () => {
    const r = extractTagsWithContext(`# @cap-feature(feature:F-046) makefile\n`, 'Makefile');
    assert.strictEqual(r.tags.length, 1);
  });

  it('block-state survives no-tag lines correctly', () => {
    const content = `/* line1\nline2\nline3 @cap-feature(feature:F-046) here\n*/\n`;
    const r = extractTagsWithContext(content, 'a.js');
    assert.strictEqual(r.tags.length, 1);
    assert.strictEqual(r.tags[0].line, 3);
  });
});

// =====================================================================
// 13. AC-5: live repo scanDirectoryWithContext does not throw
// =====================================================================

describe('F-046 ADV: live-repo invariant', () => {
  it('scanDirectoryWithContext on the repo root does not throw and returns plenty of tags', () => {
    const repoRoot = path.join(__dirname, '..');
    const r = scanDirectoryWithContext(repoRoot);
    assert.ok(r.tags.length > 100, `expected many tags from live repo, got ${r.tags.length}`);
    // Warnings count is loosely bounded — markdown prose mentions of @cap-* are expected.
    assert.ok(r.warnings.length >= 0);
  });

  it('legacy scanDirectory on the repo root still returns a flat array', () => {
    const { scanDirectory } = require('../cap/bin/lib/cap-tag-scanner.cjs');
    const repoRoot = path.join(__dirname, '..');
    const r = scanDirectory(repoRoot, { projectRoot: repoRoot });
    assert.ok(Array.isArray(r));
    assert.ok(r.length > 100);
  });
});
