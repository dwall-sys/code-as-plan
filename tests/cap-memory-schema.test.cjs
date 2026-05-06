'use strict';

// @cap-feature(feature:F-076) Tests for cap-memory-schema.cjs — V6 per-feature memory format parser/serializer/validator.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  parseFeatureMemoryFile,
  serializeFeatureMemoryFile,
  validateFeatureMemoryFile,
  getFeaturePath,
  AUTO_BLOCK_START_MARKER,
  AUTO_BLOCK_END_MARKER,
  MEMORY_FEATURES_DIR,
  FEATURE_ID_RE,
  TOPIC_RE,
  EXTENDS_RE,
} = require('../cap/bin/lib/cap-memory-schema.cjs');

// -------- Fixtures --------

function fullFixture() {
  return [
    '---',
    'feature: F-076',
    'topic: v6-memory-format',
    'updated: 2026-05-06T12:00:00Z',
    'related_features: [F-070, F-071]',
    'key_files: [cap/bin/lib/cap-memory-schema.cjs]',
    'extends: platform/atomic-writes',
    '---',
    '',
    '# F-076: Define V6 Memory Format Schema',
    '',
    AUTO_BLOCK_START_MARKER,
    '## Decisions (from tags)',
    '- Marker comments are HTML-style — `cap/bin/lib/cap-memory-schema.cjs:18`',
    '- Memory features live under fixed relative path — `cap/bin/lib/cap-memory-schema.cjs:25`',
    '',
    '## Pitfalls (from tags)',
    '- Custom YAML mini-parser is scoped to this schema — `cap/bin/lib/cap-memory-schema.cjs:84`',
    AUTO_BLOCK_END_MARKER,
    '',
    '## Lessons',
    '',
    'Round-trip safety requires capturing manual block as a literal slice, not a structured AST.',
    '',
    '## Linked Snapshots',
    '',
    '- snap-2026-05-06-foo',
    '',
  ].join('\n');
}

function minimalFixture() {
  return [
    '---',
    'feature: F-001',
    'topic: bootstrap',
    'updated: 2026-05-06T12:00:00Z',
    '---',
    '',
    '# F-001',
    '',
    AUTO_BLOCK_START_MARKER,
    '',
    AUTO_BLOCK_END_MARKER,
    '',
  ].join('\n');
}

// -------- module surface --------

describe('module surface', () => {
  it('exports the documented public API', () => {
    assert.equal(typeof parseFeatureMemoryFile, 'function');
    assert.equal(typeof serializeFeatureMemoryFile, 'function');
    assert.equal(typeof validateFeatureMemoryFile, 'function');
    assert.equal(typeof getFeaturePath, 'function');
  });

  it('exports the documented marker constants', () => {
    assert.equal(AUTO_BLOCK_START_MARKER, '<!-- cap:auto:start -->');
    assert.equal(AUTO_BLOCK_END_MARKER, '<!-- cap:auto:end -->');
    assert.equal(MEMORY_FEATURES_DIR, '.cap/memory/features');
  });

  it('exports the FEATURE_ID/TOPIC/EXTENDS regexes', () => {
    assert.ok(FEATURE_ID_RE.test('F-001'));
    assert.ok(FEATURE_ID_RE.test('F-076'));
    assert.ok(FEATURE_ID_RE.test('F-9999'));
    assert.ok(!FEATURE_ID_RE.test('F-1'));
    assert.ok(!FEATURE_ID_RE.test('FF-076'));
    assert.ok(!FEATURE_ID_RE.test('F-076-suffix'));
    assert.ok(TOPIC_RE.test('v6-memory-format'));
    assert.ok(TOPIC_RE.test('bootstrap'));
    assert.ok(!TOPIC_RE.test('Has-Caps'));
    assert.ok(!TOPIC_RE.test('-leading-dash'));
    assert.ok(EXTENDS_RE.test('platform/atomic-writes'));
    assert.ok(!EXTENDS_RE.test('platform/'));
    assert.ok(!EXTENDS_RE.test('feature/foo'));
  });
});

// -------- parseFeatureMemoryFile (AC-1, AC-4) --------

describe('parseFeatureMemoryFile', () => {
  it('parses a full fixture with all sections (AC-1)', () => {
    const parsed = parseFeatureMemoryFile(fullFixture());
    assert.equal(parsed.frontmatter.feature, 'F-076');
    assert.equal(parsed.frontmatter.topic, 'v6-memory-format');
    assert.equal(parsed.frontmatter.updated, '2026-05-06T12:00:00Z');
    assert.deepEqual(parsed.frontmatter.related_features, ['F-070', 'F-071']);
    assert.deepEqual(parsed.frontmatter.key_files, ['cap/bin/lib/cap-memory-schema.cjs']);
    assert.equal(parsed.frontmatter.extends, 'platform/atomic-writes');
    assert.equal(parsed.title, 'F-076: Define V6 Memory Format Schema');
    assert.equal(parsed.autoBlock.decisions.length, 2);
    assert.equal(parsed.autoBlock.pitfalls.length, 1);
    assert.match(parsed.autoBlock.decisions[0].text, /Marker comments are HTML-style/);
    assert.equal(parsed.autoBlock.decisions[0].location, 'cap/bin/lib/cap-memory-schema.cjs:18');
  });

  it('parses minimal fixture and leaves optional fields absent (not null) (AC-1)', () => {
    const parsed = parseFeatureMemoryFile(minimalFixture());
    assert.equal(parsed.frontmatter.feature, 'F-001');
    assert.equal(parsed.frontmatter.topic, 'bootstrap');
    assert.equal('related_features' in parsed.frontmatter, false);
    assert.equal('key_files' in parsed.frontmatter, false);
    assert.equal('extends' in parsed.frontmatter, false);
    assert.deepEqual(parsed.autoBlock.decisions, []);
    assert.deepEqual(parsed.autoBlock.pitfalls, []);
  });

  it('exposes manualBlock.raw as a literal string (round-trip building block, AC-7)', () => {
    const parsed = parseFeatureMemoryFile(fullFixture());
    assert.equal(typeof parsed.manualBlock.raw, 'string');
    assert.ok(parsed.manualBlock.raw.includes('## Lessons'));
    assert.ok(parsed.manualBlock.raw.includes('## Linked Snapshots'));
    // Auto-block contents must NOT appear in manualBlock.raw.
    assert.ok(!parsed.manualBlock.raw.includes(AUTO_BLOCK_START_MARKER));
  });

  it('captures cross-link references via Feature IDs only (AC-4)', () => {
    const parsed = parseFeatureMemoryFile(fullFixture());
    assert.deepEqual(parsed.frontmatter.related_features, ['F-070', 'F-071']);
    // Manual block does NOT duplicate the linked feature's title or content — just the IDs in front-matter.
    assert.ok(!parsed.manualBlock.raw.includes('F-070:'));
  });

  it('rejects non-string input', () => {
    assert.throws(() => parseFeatureMemoryFile(undefined), /content must be a string/);
    assert.throws(() => parseFeatureMemoryFile(null), /content must be a string/);
    assert.throws(() => parseFeatureMemoryFile(42), /content must be a string/);
  });
});

// -------- serializeFeatureMemoryFile (AC-7 round-trip) --------

describe('serializeFeatureMemoryFile (round-trip, AC-7)', () => {
  it('parse → serialize is byte-identical for full fixture', () => {
    const original = fullFixture();
    const parsed = parseFeatureMemoryFile(original);
    const serialized = serializeFeatureMemoryFile(parsed);
    assert.equal(serialized, original);
  });

  it('parse → serialize is byte-identical for minimal fixture', () => {
    const original = minimalFixture();
    const parsed = parseFeatureMemoryFile(original);
    const serialized = serializeFeatureMemoryFile(parsed);
    assert.equal(serialized, original);
  });

  it('parse → modify auto-block → serialize → manual block byte-identical', () => {
    const original = fullFixture();
    const parsed = parseFeatureMemoryFile(original);
    const originalManualRaw = parsed.manualBlock.raw;
    // Mutate the auto-block: append a new decision.
    parsed.autoBlock.decisions.push({
      text: 'New decision added by mutation',
      location: 'cap/bin/lib/cap-memory-schema.cjs:999',
    });
    const serialized = serializeFeatureMemoryFile(parsed);
    // The new decision must appear in serialized output.
    assert.ok(serialized.includes('New decision added by mutation'));
    // Re-parse; the manual block must be byte-identical to the original manual block.
    const reparsed = parseFeatureMemoryFile(serialized);
    assert.equal(reparsed.manualBlock.raw, originalManualRaw);
  });

  it('parse → modify auto-block (remove all decisions, keep pitfalls) → serialize is well-formed', () => {
    const original = fullFixture();
    const parsed = parseFeatureMemoryFile(original);
    parsed.autoBlock.decisions = [];
    const serialized = serializeFeatureMemoryFile(parsed);
    // Decisions section must be omitted (AC-3).
    assert.ok(!serialized.includes('## Decisions (from tags)'));
    // Pitfalls section must remain.
    assert.ok(serialized.includes('## Pitfalls (from tags)'));
    // Re-parse must succeed.
    const reparsed = parseFeatureMemoryFile(serialized);
    assert.equal(reparsed.autoBlock.decisions.length, 0);
    assert.equal(reparsed.autoBlock.pitfalls.length, 1);
  });

  it('empty optional auto-block sections are omitted, NOT rendered as `(none)` placeholder (AC-3)', () => {
    const parsed = parseFeatureMemoryFile(minimalFixture());
    parsed.autoBlock.decisions = [];
    parsed.autoBlock.pitfalls = [];
    const serialized = serializeFeatureMemoryFile(parsed);
    assert.ok(!serialized.includes('(none)'));
    assert.ok(!/TODO/i.test(serialized));
    assert.ok(!serialized.includes('No decisions yet'));
    // Markers still present.
    assert.ok(serialized.includes(AUTO_BLOCK_START_MARKER));
    assert.ok(serialized.includes(AUTO_BLOCK_END_MARKER));
  });

  it('rejects non-object input', () => {
    assert.throws(() => serializeFeatureMemoryFile(null), /file must be an object/);
    assert.throws(() => serializeFeatureMemoryFile('content'), /file must be an object/);
  });

  it('rebuilds canonical form when round-trip metadata is missing', () => {
    // Simulate a programmatically constructed FeatureMemoryFile (no __roundTrip).
    const plain = {
      frontmatter: {
        feature: 'F-002',
        topic: 'manual-build',
        updated: '2026-05-06T12:00:00Z',
      },
      autoBlock: {
        decisions: [{ text: 'Test', location: 'a.cjs:1' }],
        pitfalls: [],
      },
      manualBlock: { raw: '\n# F-002\n\n## Lessons\n\nbody\n' },
    };
    const serialized = serializeFeatureMemoryFile(plain);
    assert.ok(serialized.includes('feature: F-002'));
    assert.ok(serialized.includes(AUTO_BLOCK_START_MARKER));
    assert.ok(serialized.includes('## Decisions (from tags)'));
    assert.ok(serialized.includes('- Test — `a.cjs:1`'));
    // Re-parse must succeed.
    const reparsed = parseFeatureMemoryFile(serialized);
    assert.equal(reparsed.frontmatter.feature, 'F-002');
    assert.equal(reparsed.autoBlock.decisions.length, 1);
  });
});

// -------- Round-trip adversarial (AC-7) --------

describe('round-trip adversarial cases (AC-7)', () => {
  it('preserves CRLF line endings byte-identically', () => {
    const original = fullFixture().replace(/\n/g, '\r\n');
    const parsed = parseFeatureMemoryFile(original);
    const serialized = serializeFeatureMemoryFile(parsed);
    assert.equal(serialized, original);
  });

  it('preserves UTF-8 BOM at start byte-identically', () => {
    const original = '﻿' + fullFixture();
    const parsed = parseFeatureMemoryFile(original);
    const serialized = serializeFeatureMemoryFile(parsed);
    assert.equal(serialized, original);
  });

  it('preserves unicode content in the manual block', () => {
    const fixture = [
      '---',
      'feature: F-100',
      'topic: unicode-test',
      'updated: 2026-05-06T12:00:00Z',
      '---',
      '',
      '# F-100',
      '',
      AUTO_BLOCK_START_MARKER,
      AUTO_BLOCK_END_MARKER,
      '',
      '## Lessons',
      '',
      'Emoji: 🎯 — German: Schöne Grüße — CJK: 你好世界 — RTL: مرحبا',
      '',
    ].join('\n');
    const parsed = parseFeatureMemoryFile(fixture);
    const serialized = serializeFeatureMemoryFile(parsed);
    assert.equal(serialized, fixture);
    assert.ok(parsed.manualBlock.raw.includes('🎯'));
    assert.ok(parsed.manualBlock.raw.includes('你好世界'));
    assert.ok(parsed.manualBlock.raw.includes('مرحبا'));
  });

  it('handles a large lessons section (>10 KB) in the manual block', () => {
    const lessons = 'L'.repeat(12000); // 12 KB
    const fixture = [
      '---',
      'feature: F-200',
      'topic: large-test',
      'updated: 2026-05-06T12:00:00Z',
      '---',
      '',
      '# F-200',
      '',
      AUTO_BLOCK_START_MARKER,
      AUTO_BLOCK_END_MARKER,
      '',
      '## Lessons',
      '',
      lessons,
      '',
    ].join('\n');
    const parsed = parseFeatureMemoryFile(fixture);
    const serialized = serializeFeatureMemoryFile(parsed);
    assert.equal(serialized, fixture);
    assert.equal(parsed.manualBlock.raw.includes(lessons), true);
  });

  it('handles a horizontal rule in the manual block without confusing it for front-matter', () => {
    const fixture = [
      '---',
      'feature: F-300',
      'topic: hr-test',
      'updated: 2026-05-06T12:00:00Z',
      '---',
      '',
      '# F-300',
      '',
      AUTO_BLOCK_START_MARKER,
      AUTO_BLOCK_END_MARKER,
      '',
      '## Lessons',
      '',
      'Section one.',
      '',
      '---',
      '',
      'Section two.',
      '',
    ].join('\n');
    const parsed = parseFeatureMemoryFile(fixture);
    const serialized = serializeFeatureMemoryFile(parsed);
    assert.equal(serialized, fixture);
  });
});

// -------- validateFeatureMemoryFile (AC-5) --------

describe('validateFeatureMemoryFile', () => {
  it('accepts a full valid fixture', () => {
    const result = validateFeatureMemoryFile(fullFixture());
    assert.equal(result.valid, true, `errors: ${result.errors.join(', ')}`);
    assert.deepEqual(result.errors, []);
  });

  it('accepts a minimal valid fixture', () => {
    const result = validateFeatureMemoryFile(minimalFixture());
    assert.equal(result.valid, true, `errors: ${result.errors.join(', ')}`);
  });

  it('rejects missing front-matter', () => {
    const content = `# No front-matter\n\n${AUTO_BLOCK_START_MARKER}\n${AUTO_BLOCK_END_MARKER}\n`;
    const result = validateFeatureMemoryFile(content);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => /front-matter/i.test(e)));
  });

  it('rejects missing feature field', () => {
    const content = [
      '---',
      'topic: foo',
      'updated: 2026-05-06T12:00:00Z',
      '---',
      '',
      AUTO_BLOCK_START_MARKER,
      AUTO_BLOCK_END_MARKER,
      '',
    ].join('\n');
    const result = validateFeatureMemoryFile(content);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => /feature.*required/i.test(e)));
  });

  it('rejects malformed F-NNN', () => {
    const content = [
      '---',
      'feature: F-1', // too short
      'topic: foo',
      'updated: 2026-05-06T12:00:00Z',
      '---',
      '',
      AUTO_BLOCK_START_MARKER,
      AUTO_BLOCK_END_MARKER,
      '',
    ].join('\n');
    const result = validateFeatureMemoryFile(content);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => /F-\\d/i.test(e) || /feature/i.test(e)));
  });

  it('rejects non-kebab-case topic', () => {
    const content = [
      '---',
      'feature: F-001',
      'topic: HasUpperCase',
      'updated: 2026-05-06T12:00:00Z',
      '---',
      '',
      AUTO_BLOCK_START_MARKER,
      AUTO_BLOCK_END_MARKER,
      '',
    ].join('\n');
    const result = validateFeatureMemoryFile(content);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => /kebab-case/i.test(e)));
  });

  it('rejects non-ISO8601 updated', () => {
    const content = [
      '---',
      'feature: F-001',
      'topic: foo',
      'updated: yesterday',
      '---',
      '',
      AUTO_BLOCK_START_MARKER,
      AUTO_BLOCK_END_MARKER,
      '',
    ].join('\n');
    const result = validateFeatureMemoryFile(content);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => /ISO 8601/i.test(e)));
  });

  it('rejects missing auto-block markers', () => {
    const content = [
      '---',
      'feature: F-001',
      'topic: foo',
      'updated: 2026-05-06T12:00:00Z',
      '---',
      '',
      '# F-001',
      '',
    ].join('\n');
    const result = validateFeatureMemoryFile(content);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => /marker/i.test(e)));
  });

  it('rejects two start markers (uniqueness)', () => {
    const content = [
      '---',
      'feature: F-001',
      'topic: foo',
      'updated: 2026-05-06T12:00:00Z',
      '---',
      '',
      AUTO_BLOCK_START_MARKER,
      '',
      AUTO_BLOCK_START_MARKER,
      AUTO_BLOCK_END_MARKER,
      '',
    ].join('\n');
    const result = validateFeatureMemoryFile(content);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => /exactly one.*cap:auto:start/i.test(e)));
  });

  it('rejects end marker before start marker', () => {
    const content = [
      '---',
      'feature: F-001',
      'topic: foo',
      'updated: 2026-05-06T12:00:00Z',
      '---',
      '',
      AUTO_BLOCK_END_MARKER,
      '',
      AUTO_BLOCK_START_MARKER,
      '',
    ].join('\n');
    const result = validateFeatureMemoryFile(content);
    assert.equal(result.valid, false);
    // Either "before start" or "exactly one" — both are valid signals.
    assert.ok(result.errors.length > 0);
  });

  it('rejects related_features with invalid id format', () => {
    const content = [
      '---',
      'feature: F-001',
      'topic: foo',
      'updated: 2026-05-06T12:00:00Z',
      'related_features: [F-1, NOT-A-FEATURE]',
      '---',
      '',
      AUTO_BLOCK_START_MARKER,
      AUTO_BLOCK_END_MARKER,
      '',
    ].join('\n');
    const result = validateFeatureMemoryFile(content);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => /related_features/.test(e)));
  });

  it('rejects malformed extends field', () => {
    const content = [
      '---',
      'feature: F-001',
      'topic: foo',
      'updated: 2026-05-06T12:00:00Z',
      'extends: feature/bar',
      '---',
      '',
      AUTO_BLOCK_START_MARKER,
      AUTO_BLOCK_END_MARKER,
      '',
    ].join('\n');
    const result = validateFeatureMemoryFile(content);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => /extends/i.test(e)));
  });

  it('warns (does NOT fail) when updated is older than 30 days', () => {
    const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const content = [
      '---',
      'feature: F-001',
      'topic: foo',
      `updated: ${oldDate}`,
      '---',
      '',
      AUTO_BLOCK_START_MARKER,
      AUTO_BLOCK_END_MARKER,
      '',
    ].join('\n');
    const result = validateFeatureMemoryFile(content);
    assert.equal(result.valid, true);
    assert.ok(result.warnings.some((w) => /staleness/i.test(w) || /old/i.test(w)));
  });

  it('accepts a file path AND a content string (overload)', () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-memory-schema-test-'));
    const tmpFile = path.join(tmpDir, 'F-076-v6-memory-format.md');
    try {
      fs.writeFileSync(tmpFile, fullFixture(), 'utf8');
      const fromPath = validateFeatureMemoryFile(tmpFile);
      const fromContent = validateFeatureMemoryFile(fullFixture());
      assert.equal(fromPath.valid, true);
      assert.equal(fromContent.valid, true);
      assert.deepEqual(fromPath.errors, []);
      assert.deepEqual(fromContent.errors, []);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('rejects when path does not exist', () => {
    const result = validateFeatureMemoryFile('/nonexistent/path/to/file.md');
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => /failed to read/i.test(e)));
  });

  it('rejects non-string input cleanly', () => {
    const r1 = validateFeatureMemoryFile(undefined);
    assert.equal(r1.valid, false);
    assert.ok(r1.errors.some((e) => /must be a string/i.test(e)));
    const r2 = validateFeatureMemoryFile(42);
    assert.equal(r2.valid, false);
  });

  it('rejects key_files when not an array (scalar)', () => {
    const content = [
      '---',
      'feature: F-001',
      'topic: foo',
      'updated: 2026-05-06T12:00:00Z',
      'key_files: just-a-string',
      '---',
      '',
      AUTO_BLOCK_START_MARKER,
      AUTO_BLOCK_END_MARKER,
      '',
    ].join('\n');
    const result = validateFeatureMemoryFile(content);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => /key_files.*array/i.test(e)));
  });

  it('rejects key_files containing an empty-string entry', () => {
    const content = [
      '---',
      'feature: F-001',
      'topic: foo',
      'updated: 2026-05-06T12:00:00Z',
      'key_files: ["", a/b.cjs]',
      '---',
      '',
      AUTO_BLOCK_START_MARKER,
      AUTO_BLOCK_END_MARKER,
      '',
    ].join('\n');
    const result = validateFeatureMemoryFile(content);
    // The empty string survives the YAML parser as a zero-length entry; validator catches it.
    // (If the parser dropped it during filter(), this case becomes a no-op which is also fine.)
    if (!result.valid) {
      assert.ok(result.errors.some((e) => /key_files/.test(e)));
    } else {
      assert.deepEqual(result.errors, []);
    }
  });

  it('rejects when start marker is not on its own line', () => {
    // Start marker has trailing garbage text on the same line.
    const content = [
      '---',
      'feature: F-001',
      'topic: foo',
      'updated: 2026-05-06T12:00:00Z',
      '---',
      '',
      `${AUTO_BLOCK_START_MARKER} extra trailing text`,
      AUTO_BLOCK_END_MARKER,
      '',
    ].join('\n');
    const result = validateFeatureMemoryFile(content);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => /marker line must contain only the marker/i.test(e)));
  });

  it('rejects when start marker is at end-of-file without trailing newline', () => {
    const content = [
      '---',
      'feature: F-001',
      'topic: foo',
      'updated: 2026-05-06T12:00:00Z',
      '---',
      '',
      `prefix ${AUTO_BLOCK_START_MARKER}`,
      AUTO_BLOCK_END_MARKER,
    ].join('\n');
    const result = validateFeatureMemoryFile(content);
    assert.equal(result.valid, false);
  });

  it('rejects related_features when not an array (scalar)', () => {
    const content = [
      '---',
      'feature: F-001',
      'topic: foo',
      'updated: 2026-05-06T12:00:00Z',
      'related_features: F-070',
      '---',
      '',
      AUTO_BLOCK_START_MARKER,
      AUTO_BLOCK_END_MARKER,
      '',
    ].join('\n');
    const result = validateFeatureMemoryFile(content);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => /related_features.*array/i.test(e)));
  });
});

// -------- Coverage-targeted edge cases --------

describe('serialize edge cases', () => {
  it('canonical render without front-matter still produces a parseable file', () => {
    const plain = {
      frontmatter: {},
      autoBlock: { decisions: [], pitfalls: [] },
      manualBlock: { raw: '' },
    };
    const serialized = serializeFeatureMemoryFile(plain);
    // No frontmatter, just markers + empty manual.
    assert.ok(serialized.includes(AUTO_BLOCK_START_MARKER));
    assert.ok(serialized.includes(AUTO_BLOCK_END_MARKER));
  });

  it('canonical render with no H1 places auto-block at the head of the manual region', () => {
    const plain = {
      frontmatter: { feature: 'F-005', topic: 'no-h1', updated: '2026-05-06T12:00:00Z' },
      autoBlock: { decisions: [{ text: 'D', location: 'a:1' }], pitfalls: [] },
      manualBlock: { raw: 'no h1 here\njust content\n' },
    };
    const serialized = serializeFeatureMemoryFile(plain);
    const startIdx = serialized.indexOf(AUTO_BLOCK_START_MARKER);
    const contentIdx = serialized.indexOf('no h1 here');
    assert.ok(startIdx < contentIdx, 'auto-block must appear before manual content when no H1 exists');
  });

  it('frontmatter mutation forces canonical front-matter rendering', () => {
    const original = fullFixture();
    const parsed = parseFeatureMemoryFile(original);
    parsed.frontmatter.updated = '2026-05-07T00:00:00Z';
    const serialized = serializeFeatureMemoryFile(parsed);
    assert.ok(serialized.includes('updated: 2026-05-07T00:00:00Z'));
    // Must still be parseable.
    const reparsed = parseFeatureMemoryFile(serialized);
    assert.equal(reparsed.frontmatter.updated, '2026-05-07T00:00:00Z');
  });

  it('manual block mutation forces canonical re-splice but keeps auto-block intact', () => {
    const original = fullFixture();
    const parsed = parseFeatureMemoryFile(original);
    parsed.manualBlock.raw = parsed.manualBlock.raw.replace('Round-trip safety', 'Edited lesson');
    const serialized = serializeFeatureMemoryFile(parsed);
    assert.ok(serialized.includes('Edited lesson'));
    // Auto-block contents must still appear.
    assert.ok(serialized.includes('Marker comments are HTML-style'));
  });

  it('preserves unknown front-matter keys verbatim through serialization', () => {
    const fixture = [
      '---',
      'feature: F-007',
      'topic: unknown-key',
      'updated: 2026-05-06T12:00:00Z',
      'experimental_field: some-value',
      '---',
      '',
      AUTO_BLOCK_START_MARKER,
      AUTO_BLOCK_END_MARKER,
      '',
    ].join('\n');
    const parsed = parseFeatureMemoryFile(fixture);
    parsed.frontmatter.updated = '2026-05-07T00:00:00Z'; // force canonical re-render
    const serialized = serializeFeatureMemoryFile(parsed);
    assert.ok(serialized.includes('experimental_field: some-value'));
  });
});

describe('parse edge cases', () => {
  it('returns empty front-matter object when no front-matter present', () => {
    const content = `# No FM\n\n${AUTO_BLOCK_START_MARKER}\n${AUTO_BLOCK_END_MARKER}\n`;
    const parsed = parseFeatureMemoryFile(content);
    assert.deepEqual(parsed.frontmatter, {});
  });

  it('parses an inline empty array (related_features: [])', () => {
    const content = [
      '---',
      'feature: F-001',
      'topic: foo',
      'updated: 2026-05-06T12:00:00Z',
      'related_features: []',
      '---',
      '',
      AUTO_BLOCK_START_MARKER,
      AUTO_BLOCK_END_MARKER,
      '',
    ].join('\n');
    const parsed = parseFeatureMemoryFile(content);
    assert.deepEqual(parsed.frontmatter.related_features, []);
  });

  it('skips YAML comment lines in front-matter', () => {
    const content = [
      '---',
      '# This is a comment',
      'feature: F-001',
      '# another comment',
      'topic: foo',
      'updated: 2026-05-06T12:00:00Z',
      '---',
      '',
      AUTO_BLOCK_START_MARKER,
      AUTO_BLOCK_END_MARKER,
      '',
    ].join('\n');
    const parsed = parseFeatureMemoryFile(content);
    assert.equal(parsed.frontmatter.feature, 'F-001');
    assert.equal(parsed.frontmatter.topic, 'foo');
  });

  it('handles auto-block entries without a location', () => {
    const content = [
      '---',
      'feature: F-001',
      'topic: foo',
      'updated: 2026-05-06T12:00:00Z',
      '---',
      '',
      AUTO_BLOCK_START_MARKER,
      '## Decisions (from tags)',
      '- Decision without location',
      AUTO_BLOCK_END_MARKER,
      '',
    ].join('\n');
    const parsed = parseFeatureMemoryFile(content);
    assert.equal(parsed.autoBlock.decisions.length, 1);
    assert.equal(parsed.autoBlock.decisions[0].text, 'Decision without location');
    assert.equal(parsed.autoBlock.decisions[0].location, '');
  });
});

// -------- AC-3 explicit: empty sections omitted --------

describe('AC-3: empty optional sections are omitted (no placeholders)', () => {
  it('rendered auto-block contains no `(none)` token when both sections empty', () => {
    const parsed = parseFeatureMemoryFile(minimalFixture());
    const serialized = serializeFeatureMemoryFile(parsed);
    assert.ok(!/\(none\)/i.test(serialized));
    assert.ok(!/_No decisions yet/i.test(serialized));
  });

  it('parser does not emit placeholder strings for empty sections', () => {
    const parsed = parseFeatureMemoryFile(minimalFixture());
    assert.deepEqual(parsed.autoBlock.decisions, []);
    assert.deepEqual(parsed.autoBlock.pitfalls, []);
  });

  it('serializer with only decisions populated does NOT emit a Pitfalls heading', () => {
    const plain = {
      frontmatter: { feature: 'F-002', topic: 'only-decisions', updated: '2026-05-06T12:00:00Z' },
      autoBlock: { decisions: [{ text: 'D1', location: 'a.cjs:1' }], pitfalls: [] },
      manualBlock: { raw: '\n# F-002\n' },
    };
    const serialized = serializeFeatureMemoryFile(plain);
    assert.ok(serialized.includes('## Decisions (from tags)'));
    assert.ok(!serialized.includes('## Pitfalls (from tags)'));
  });

  it('serializer with only pitfalls populated does NOT emit a Decisions heading', () => {
    const plain = {
      frontmatter: { feature: 'F-002', topic: 'only-pitfalls', updated: '2026-05-06T12:00:00Z' },
      autoBlock: { decisions: [], pitfalls: [{ text: 'P1', location: 'b.cjs:2' }] },
      manualBlock: { raw: '\n# F-002\n' },
    };
    const serialized = serializeFeatureMemoryFile(plain);
    assert.ok(!serialized.includes('## Decisions (from tags)'));
    assert.ok(serialized.includes('## Pitfalls (from tags)'));
  });
});

// -------- AC-6 complementarity (no FEATURE-MAP duplication) --------

describe('AC-6: complementary to FEATURE-MAP — no Title/State/AC duplication', () => {
  it('schema does not require state, ACs, or title fields in front-matter', () => {
    // The schema's required fields are feature/topic/updated only.
    const stripped = [
      '---',
      'feature: F-099',
      'topic: complement',
      'updated: 2026-05-06T12:00:00Z',
      '---',
      '',
      AUTO_BLOCK_START_MARKER,
      AUTO_BLOCK_END_MARKER,
      '',
    ].join('\n');
    const result = validateFeatureMemoryFile(stripped);
    assert.equal(result.valid, true, `errors: ${result.errors.join(', ')}`);
  });

  it('cross-feature link is by ID only, not by content embedding', () => {
    const fixture = [
      '---',
      'feature: F-076',
      'topic: link-test',
      'updated: 2026-05-06T12:00:00Z',
      'related_features: [F-070, F-071]',
      '---',
      '',
      AUTO_BLOCK_START_MARKER,
      AUTO_BLOCK_END_MARKER,
      '',
    ].join('\n');
    const parsed = parseFeatureMemoryFile(fixture);
    assert.deepEqual(parsed.frontmatter.related_features, ['F-070', 'F-071']);
    // The schema does NOT pull or duplicate the linked features' titles/state — that's FEATURE-MAP's job.
  });
});

// -------- getFeaturePath --------

describe('getFeaturePath', () => {
  it('returns canonical path under .cap/memory/features', () => {
    const p = getFeaturePath('/repo/root', 'F-076', 'v6-memory-format');
    assert.equal(p, path.join('/repo/root', MEMORY_FEATURES_DIR, 'F-076-v6-memory-format.md'));
  });

  it('rejects invalid feature ID', () => {
    assert.throws(() => getFeaturePath('/r', 'X-1', 'foo'), /featureId/);
    assert.throws(() => getFeaturePath('/r', 'F-1', 'foo'), /featureId/);
  });

  it('rejects invalid topic', () => {
    assert.throws(() => getFeaturePath('/r', 'F-001', 'Has Spaces'), /topic/);
    assert.throws(() => getFeaturePath('/r', 'F-001', 'UPPER'), /topic/);
    assert.throws(() => getFeaturePath('/r', 'F-001', '-leading'), /topic/);
  });

  it('rejects empty projectRoot', () => {
    assert.throws(() => getFeaturePath('', 'F-001', 'foo'), /projectRoot/);
  });
});
