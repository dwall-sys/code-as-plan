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
    assert.ok(typeof result === 'string', 'should return a string');
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
});
