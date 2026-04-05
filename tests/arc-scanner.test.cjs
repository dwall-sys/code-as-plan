/**
 * GSD Tools Tests - arc-scanner.cjs
 *
 * Unit tests for the ARC annotation tag scanner module.
 * Tests false-positive prevention (strings, URLs, template literals),
 * metadata parsing, phase/type filtering, and output formatting.
 *
 * Requirements: SCAN-01, SCAN-02, SCAN-03, SCAN-04
 */

'use strict';
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createTempProject, cleanup } = require('./helpers.cjs');
const arcScanner = require('../cap/bin/lib/arc-scanner.cjs');

// ─── scanFile — basic extraction ─────────────────────────────────────────────

describe('arc-scanner scanFile', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('extracts @gsd-context tag from JS single-line comment', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'fixture.js'),
      '// @gsd-context Auth module\nfunction authenticate() {}',
      'utf-8'
    );
    const tags = arcScanner.scanFile(path.join(tmpDir, 'fixture.js'));
    assert.strictEqual(tags.length, 1);
    assert.strictEqual(tags[0].type, 'context');
    assert.strictEqual(tags[0].description, 'Auth module');
    assert.deepStrictEqual(tags[0].metadata, {});
    assert.strictEqual(tags[0].line, 1);
  });

  test('extracts @gsd-todo tag with metadata (phase and priority)', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'fixture.js'),
      '// @gsd-todo(phase:2, priority:high) Fix this\nconst x = 1;',
      'utf-8'
    );
    const tags = arcScanner.scanFile(path.join(tmpDir, 'fixture.js'));
    assert.strictEqual(tags.length, 1);
    assert.strictEqual(tags[0].type, 'todo');
    assert.strictEqual(tags[0].description, 'Fix this');
    assert.deepStrictEqual(tags[0].metadata, { phase: '2', priority: 'high' });
    assert.ok('priority' in tags[0].metadata, 'metadata should have priority key');
  });

  test('extracts @gsd-decision from Python hash comment', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'fixture.py'),
      '# @gsd-decision Use bcrypt\ndef hash_password(): pass',
      'utf-8'
    );
    const tags = arcScanner.scanFile(path.join(tmpDir, 'fixture.py'));
    assert.strictEqual(tags.length, 1);
    assert.strictEqual(tags[0].type, 'decision');
    assert.strictEqual(tags[0].description, 'Use bcrypt');
  });

  test('extracts @gsd-context from SQL double-dash comment', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'fixture.sql'),
      '-- @gsd-context Partitioned view\nCREATE VIEW tenant_events AS SELECT 1;',
      'utf-8'
    );
    const tags = arcScanner.scanFile(path.join(tmpDir, 'fixture.sql'));
    assert.strictEqual(tags.length, 1);
    assert.strictEqual(tags[0].type, 'context');
  });

  test('tag object has required fields: type, file, line, metadata, description, raw', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'fixture.js'),
      '// @gsd-context My module\n',
      'utf-8'
    );
    const tags = arcScanner.scanFile(path.join(tmpDir, 'fixture.js'));
    assert.strictEqual(tags.length, 1);
    const tag = tags[0];
    assert.ok('type' in tag, 'missing field: type');
    assert.ok('file' in tag, 'missing field: file');
    assert.ok('line' in tag, 'missing field: line');
    assert.ok('metadata' in tag, 'missing field: metadata');
    assert.ok('description' in tag, 'missing field: description');
    assert.ok('raw' in tag, 'missing field: raw');
  });

  test('line numbers are 1-based', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'fixture.js'),
      'const x = 1;\nconst y = 2;\n// @gsd-context Third line\n',
      'utf-8'
    );
    const tags = arcScanner.scanFile(path.join(tmpDir, 'fixture.js'));
    assert.strictEqual(tags.length, 1);
    assert.strictEqual(tags[0].line, 3);
  });

  test('extracts multiple tags from a single file', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'fixture.js'),
      '// @gsd-context Auth module\n// @gsd-decision Use bcrypt\n// @gsd-todo(phase:2) Add refresh tokens\n',
      'utf-8'
    );
    const tags = arcScanner.scanFile(path.join(tmpDir, 'fixture.js'));
    assert.strictEqual(tags.length, 3);
    assert.strictEqual(tags[0].type, 'context');
    assert.strictEqual(tags[1].type, 'decision');
    assert.strictEqual(tags[2].type, 'todo');
  });
});

// ─── scanFile — false-positive prevention ─────────────────────────────────────

describe('arc-scanner scanFile false-positive prevention', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('does NOT extract @gsd- from inside a JS string literal', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'string-trap.js'),
      'const msg = "// @gsd-todo this is not a tag";\n',
      'utf-8'
    );
    const tags = arcScanner.scanFile(path.join(tmpDir, 'string-trap.js'));
    assert.strictEqual(tags.length, 0, 'should produce zero tags from string literal');
  });

  test('does NOT extract @gsd- from inside a URL string', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'url-trap.js'),
      'const url = "https://example.com/@gsd-internal/pkg";\n',
      'utf-8'
    );
    const tags = arcScanner.scanFile(path.join(tmpDir, 'url-trap.js'));
    assert.strictEqual(tags.length, 0, 'should produce zero tags from URL in string');
  });

  test('does NOT extract @gsd- from a template literal', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'template-trap.js'),
      'const tmpl = `@gsd-todo fix this`;\n',
      'utf-8'
    );
    const tags = arcScanner.scanFile(path.join(tmpDir, 'template-trap.js'));
    assert.strictEqual(tags.length, 0, 'should produce zero tags from template literal');
  });

  test('does NOT extract @gsd- when non-whitespace content precedes comment token', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'inline-trap.js'),
      'const x = 1; // @gsd-context inline comment\n',
      'utf-8'
    );
    const tags = arcScanner.scanFile(path.join(tmpDir, 'inline-trap.js'));
    assert.strictEqual(tags.length, 0, 'should produce zero tags when content precedes comment token');
  });
});

// ─── scanDirectory ────────────────────────────────────────────────────────────

describe('arc-scanner scanDirectory', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('scans all files and returns tags from multiple files', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'a.js'),
      '// @gsd-context File A\n',
      'utf-8'
    );
    fs.writeFileSync(
      path.join(tmpDir, 'b.py'),
      '# @gsd-decision File B\n',
      'utf-8'
    );
    const tags = arcScanner.scanDirectory(tmpDir);
    assert.ok(tags.length >= 2, `expected at least 2 tags, got ${tags.length}`);
    const types = tags.map(t => t.type);
    assert.ok(types.includes('context'), 'should include context tag');
    assert.ok(types.includes('decision'), 'should include decision tag');
  });

  test('phaseFilter returns only tags where metadata.phase matches', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'a.js'),
      '// @gsd-todo(phase:2) Phase two task\n// @gsd-todo(phase:3) Phase three task\n',
      'utf-8'
    );
    const tags = arcScanner.scanDirectory(tmpDir, { phaseFilter: '2' });
    assert.ok(tags.length >= 1, 'should return at least one tag');
    for (const tag of tags) {
      assert.strictEqual(tag.metadata.phase, '2', `unexpected phase: ${tag.metadata.phase}`);
    }
  });

  test('typeFilter returns only tags where type matches', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'a.js'),
      '// @gsd-todo Fix this\n// @gsd-context About this\n',
      'utf-8'
    );
    const tags = arcScanner.scanDirectory(tmpDir, { typeFilter: 'todo' });
    assert.ok(tags.length >= 1, 'should return at least one tag');
    for (const tag of tags) {
      assert.strictEqual(tag.type, 'todo', `unexpected type: ${tag.type}`);
    }
  });

  test('excludes node_modules directory by default', () => {
    const nodeModules = path.join(tmpDir, 'node_modules');
    fs.mkdirSync(nodeModules, { recursive: true });
    fs.writeFileSync(
      path.join(nodeModules, 'dep.js'),
      '// @gsd-context This should be excluded\n',
      'utf-8'
    );
    fs.writeFileSync(
      path.join(tmpDir, 'main.js'),
      '// @gsd-context Main file\n',
      'utf-8'
    );
    const tags = arcScanner.scanDirectory(tmpDir);
    // All returned tags should come from main.js, not from node_modules
    for (const tag of tags) {
      assert.ok(
        !tag.file.includes('node_modules'),
        `tag from node_modules should be excluded: ${tag.file}`
      );
    }
  });
});

// ─── formatAsJson ─────────────────────────────────────────────────────────────

describe('arc-scanner formatAsJson', () => {
  test('returns valid JSON string parseable by JSON.parse', () => {
    const tags = [
      { type: 'context', file: 'a.js', line: 1, metadata: {}, description: 'test', raw: '// @gsd-context test' },
    ];
    const result = arcScanner.formatAsJson(tags);
    assert.strictEqual(typeof result, 'string', 'should return a string');
    const parsed = JSON.parse(result);
    assert.ok(Array.isArray(parsed), 'should parse to an array');
    assert.strictEqual(parsed.length, 1);
    assert.strictEqual(parsed[0].type, 'context');
  });

  test('returns empty array JSON for empty tag list', () => {
    const result = arcScanner.formatAsJson([]);
    const parsed = JSON.parse(result);
    assert.ok(Array.isArray(parsed));
    assert.strictEqual(parsed.length, 0);
  });
});

// ─── formatAsMarkdown ─────────────────────────────────────────────────────────

describe('arc-scanner formatAsMarkdown', () => {
  test('output contains ## Summary Statistics section', () => {
    const tags = [
      { type: 'context', file: 'src/auth.js', line: 1, metadata: {}, description: 'Auth module', raw: '// @gsd-context Auth module' },
      { type: 'todo', file: 'src/auth.js', line: 2, metadata: { phase: '2' }, description: 'Fix this', raw: '// @gsd-todo(phase:2) Fix this' },
    ];
    const result = arcScanner.formatAsMarkdown(tags, 'TestProject');
    assert.strictEqual(typeof result, 'string', 'should return a string');
    assert.ok(result.length > 0, 'result should not be empty');
    assert.ok(result.includes('## Summary Statistics'), 'should contain ## Summary Statistics');
  });

  test('output contains ## Tags by Type section', () => {
    const tags = [
      { type: 'context', file: 'src/auth.js', line: 1, metadata: {}, description: 'Auth module', raw: '// @gsd-context Auth module' },
    ];
    const result = arcScanner.formatAsMarkdown(tags, 'TestProject');
    assert.ok(result.includes('## Tags by Type'), 'should contain ## Tags by Type');
  });

  test('output contains tag type and file sections', () => {
    const tags = [
      { type: 'context', file: 'src/auth.js', line: 1, metadata: {}, description: 'Auth module', raw: '// @gsd-context Auth module' },
    ];
    const result = arcScanner.formatAsMarkdown(tags, 'TestProject');
    assert.ok(result.includes('@gsd-context'), 'should reference tag type');
    assert.ok(result.includes('src/auth.js'), 'should reference the file');
  });

  test('output contains ## Phase Reference Index section', () => {
    const tags = [
      { type: 'todo', file: 'src/main.js', line: 5, metadata: { phase: '2' }, description: 'Phase 2 work', raw: '// @gsd-todo(phase:2) Phase 2 work' },
    ];
    const result = arcScanner.formatAsMarkdown(tags, 'TestProject');
    assert.ok(result.includes('## Phase Reference Index'), 'should contain ## Phase Reference Index');
  });

  test('uses "Unknown Project" when projectName is not provided', () => {
    const tags = [
      { type: 'context', file: 'a.js', line: 1, metadata: {}, description: 'test', raw: '// @gsd-context test' },
    ];
    const result = arcScanner.formatAsMarkdown(tags);
    assert.ok(result.includes('Unknown Project'), 'should use "Unknown Project" as default');
  });

  test('renders metadata key-value pairs in the table', () => {
    const tags = [
      { type: 'todo', file: 'a.js', line: 1, metadata: { phase: '2', priority: 'high' }, description: 'Fix', raw: '// @gsd-todo Fix' },
    ];
    const result = arcScanner.formatAsMarkdown(tags, 'Test');
    assert.ok(result.includes('phase:2'), 'should contain metadata key-value pair');
    assert.ok(result.includes('priority:high'), 'should contain second metadata entry');
  });

  test('renders dash for empty metadata and empty description', () => {
    const tags = [
      { type: 'context', file: 'a.js', line: 5, metadata: {}, description: '', raw: '// @gsd-context' },
    ];
    const result = arcScanner.formatAsMarkdown(tags, 'Test');
    // Both metadata and description should show dash
    const lines = result.split('\n');
    const dataRow = lines.find(l => l.includes('| 5 |'));
    assert.ok(dataRow, 'should have a row for line 5');
    // The row should contain two dashes for empty metadata and empty description
    const dashes = (dataRow.match(/—/g) || []).length;
    assert.ok(dashes >= 2, 'should have dashes for empty metadata and description');
  });

  test('singular "file" when only one file has tags', () => {
    const tags = [
      { type: 'context', file: 'only.js', line: 1, metadata: {}, description: 'only file', raw: '// @gsd-context only file' },
    ];
    const result = arcScanner.formatAsMarkdown(tags, 'Test');
    assert.ok(result.includes('1 file'), 'should say "1 file" (singular)');
  });

  test('handles tags with untagged phase in Phase Reference Index', () => {
    const tags = [
      { type: 'context', file: 'a.js', line: 1, metadata: {}, description: 'no phase', raw: '// @gsd-context no phase' },
      { type: 'todo', file: 'b.js', line: 1, metadata: { phase: '1' }, description: 'phase 1', raw: '// @gsd-todo phase 1' },
    ];
    const result = arcScanner.formatAsMarkdown(tags, 'Test');
    assert.ok(result.includes('(untagged)'), 'should contain (untagged) in Phase Reference Index');
  });
});

// ─── scanFile — edge cases ──────────────────────────────────────────────────

describe('arc-scanner scanFile edge cases', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns empty array for nonexistent file', () => {
    const tags = arcScanner.scanFile(path.join(tmpDir, 'nonexistent.js'));
    assert.deepStrictEqual(tags, []);
  });

  test('ignores unknown @gsd- tag types', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'fixture.js'),
      '// @gsd-unknown some text\n// @gsd-context valid tag\n',
      'utf-8'
    );
    const tags = arcScanner.scanFile(path.join(tmpDir, 'fixture.js'));
    assert.strictEqual(tags.length, 1);
    assert.strictEqual(tags[0].type, 'context');
  });

  test('parseMetadata handles entries without colon (skips them)', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'fixture.js'),
      '// @gsd-todo(nokey, phase:2) test\n',
      'utf-8'
    );
    const tags = arcScanner.scanFile(path.join(tmpDir, 'fixture.js'));
    assert.strictEqual(tags.length, 1);
    assert.deepStrictEqual(tags[0].metadata, { phase: '2' });
  });

  test('parseMetadata handles empty key gracefully', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'fixture.js'),
      '// @gsd-todo(:val) test\n',
      'utf-8'
    );
    const tags = arcScanner.scanFile(path.join(tmpDir, 'fixture.js'));
    assert.strictEqual(tags.length, 1);
    // Empty key should be skipped
    assert.deepStrictEqual(tags[0].metadata, {});
  });
});

// ─── scanDirectory — .gsdignore and excludes ────────────────────────────────

describe('arc-scanner scanDirectory .gsdignore and excludes', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('respects .gsdignore file to exclude directories', () => {
    // Create .gsdignore at scan root
    fs.writeFileSync(path.join(tmpDir, '.gsdignore'), 'vendor\n# comment\n\n', 'utf-8');
    // Create vendor dir with a tag
    fs.mkdirSync(path.join(tmpDir, 'vendor'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'vendor', 'lib.js'), '// @gsd-context vendored\n', 'utf-8');
    // Create src dir with a tag
    fs.writeFileSync(path.join(tmpDir, 'src.js'), '// @gsd-context source\n', 'utf-8');

    const tags = arcScanner.scanDirectory(tmpDir);
    const files = tags.map(t => t.file);
    assert.ok(!files.some(f => f.includes('vendor')), 'vendor should be excluded by .gsdignore');
    assert.ok(files.some(f => f.includes('src.js')), 'src.js should be included');
  });

  test('respects options.excludes to skip additional directories', () => {
    fs.mkdirSync(path.join(tmpDir, 'custom-skip'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'custom-skip', 'lib.js'), '// @gsd-context excluded\n', 'utf-8');
    fs.writeFileSync(path.join(tmpDir, 'main.js'), '// @gsd-context included\n', 'utf-8');

    const tags = arcScanner.scanDirectory(tmpDir, { excludes: ['custom-skip'] });
    const files = tags.map(t => t.file);
    assert.ok(!files.some(f => f.includes('custom-skip')), 'custom-skip should be excluded');
    assert.ok(files.some(f => f.includes('main.js')), 'main.js should be included');
  });

  test('handles unreadable directory gracefully in walk', () => {
    // A directory that does not exist should return empty tags
    const tags = arcScanner.scanDirectory(path.join(tmpDir, 'nonexistent'));
    assert.deepStrictEqual(tags, []);
  });

  test('phaseFilter with null returns all tags', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'a.js'),
      '// @gsd-todo(phase:2) Phase two\n// @gsd-context no phase\n',
      'utf-8'
    );
    const tags = arcScanner.scanDirectory(tmpDir, { phaseFilter: null });
    assert.ok(tags.length >= 2, 'null phaseFilter should return all tags');
  });
});

// ─── cmdExtractTags ─────────────────────────────────────────────────────────

describe('arc-scanner cmdExtractTags', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('writes JSON output to file when outputFile is specified', () => {
    fs.writeFileSync(path.join(tmpDir, 'src.js'), '// @gsd-context test\n', 'utf-8');
    const outFile = path.join(tmpDir, 'output', 'tags.json');

    arcScanner.cmdExtractTags(tmpDir, tmpDir, { format: 'json', outputFile: outFile });

    assert.ok(fs.existsSync(outFile), 'output file should be created');
    const content = fs.readFileSync(outFile, 'utf-8');
    const parsed = JSON.parse(content);
    assert.ok(Array.isArray(parsed), 'output should be a JSON array');
  });

  test('writes markdown output to file when format is md', () => {
    fs.writeFileSync(path.join(tmpDir, 'src.js'), '// @gsd-todo(phase:1) task\n', 'utf-8');
    const outFile = path.join(tmpDir, 'output', 'CODE-INVENTORY.md');

    arcScanner.cmdExtractTags(tmpDir, tmpDir, { format: 'md', outputFile: outFile, projectName: 'TestProj' });

    assert.ok(fs.existsSync(outFile), 'output file should be created');
    const content = fs.readFileSync(outFile, 'utf-8');
    assert.ok(content.includes('## Summary Statistics'), 'markdown should contain Summary Statistics');
  });

  test('writes to stdout when no outputFile specified', () => {
    fs.writeFileSync(path.join(tmpDir, 'src.js'), '// @gsd-context tag\n', 'utf-8');
    // This should not throw — it writes to stdout
    // We just verify it does not crash
    const originalWrite = process.stdout.write;
    let captured = '';
    process.stdout.write = (data) => { captured += data; return true; };
    try {
      arcScanner.cmdExtractTags(tmpDir, tmpDir, { format: 'json' });
      assert.ok(captured.length > 0, 'should have written something to stdout');
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  test('defaults to cwd when targetPath is not provided', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.js'), '// @gsd-context tag\n', 'utf-8');
    const outFile = path.join(tmpDir, 'out.json');

    arcScanner.cmdExtractTags(tmpDir, undefined, { format: 'json', outputFile: outFile });

    assert.ok(fs.existsSync(outFile), 'output file should be created');
    const parsed = JSON.parse(fs.readFileSync(outFile, 'utf-8'));
    assert.ok(Array.isArray(parsed), 'should be valid JSON array');
  });

  test('passes phaseFilter and typeFilter to scanDirectory', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'a.js'),
      '// @gsd-todo(phase:2) phase two task\n// @gsd-context no phase\n',
      'utf-8'
    );
    const outFile = path.join(tmpDir, 'out.json');

    arcScanner.cmdExtractTags(tmpDir, tmpDir, { format: 'json', outputFile: outFile, phaseFilter: '2', typeFilter: 'todo' });

    const parsed = JSON.parse(fs.readFileSync(outFile, 'utf-8'));
    assert.strictEqual(parsed.length, 1);
    assert.strictEqual(parsed[0].type, 'todo');
    assert.strictEqual(parsed[0].metadata.phase, '2');
  });
});
