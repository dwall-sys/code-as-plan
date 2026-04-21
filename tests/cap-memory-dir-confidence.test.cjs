'use strict';

// @cap-feature(feature:F-055) Tests for confidence/evidence rendering and lazy-migration parsing in cap-memory-dir.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  generateCategoryMarkdown,
  writeMemoryDirectory,
  readMemoryFile,
  MEMORY_DIR,
} = require('../cap/bin/lib/cap-memory-dir.cjs');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-memdir-conf-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeEntry(overrides = {}) {
  return {
    category: 'decision',
    file: '/src/auth.js',
    content: 'Use token-based refresh for all services',
    metadata: {
      source: '2026-04-01T10:00:00Z',
      branch: 'main',
      relatedFiles: ['/src/auth.js'],
      features: ['F-001'],
      pinned: false,
      confidence: 0.75,
      evidence_count: 3,
      ...(overrides.metadata || {}),
    },
    ...overrides,
  };
}

// --- AC-1: Confidence + Evidence rendering ---

describe('generateCategoryMarkdown confidence/evidence rendering (AC-1)', () => {
  it('renders Confidence and Evidence bullets for decisions', () => {
    const md = generateCategoryMarkdown('decision', [makeEntry()]);
    assert.ok(md.includes('- **Confidence:** 0.75'));
    assert.ok(md.includes('- **Evidence:** 3'));
  });

  it('renders Confidence and Evidence for pitfalls', () => {
    const entry = makeEntry({
      category: 'pitfall',
      content: 'Cache invalidation is broken during rollout windows',
      metadata: { confidence: 0.5, evidence_count: 2 },
    });
    const md = generateCategoryMarkdown('pitfall', [entry]);
    assert.ok(md.includes('- **Confidence:** 0.50'));
    assert.ok(md.includes('- **Evidence:** 2'));
  });

  it('renders Confidence and Evidence for patterns', () => {
    const entry = makeEntry({
      category: 'pattern',
      content: 'Integration tests over mocks for network-bound code paths',
      metadata: { confidence: 0.9, evidence_count: 5 },
    });
    const md = generateCategoryMarkdown('pattern', [entry]);
    assert.ok(md.includes('- **Confidence:** 0.90'));
    assert.ok(md.includes('- **Evidence:** 5'));
  });

  it('does NOT render Confidence/Evidence for hotspot table rows', () => {
    const hotspot = {
      category: 'hotspot',
      file: '/src/hot.js',
      content: 'Frequently modified',
      metadata: { sessions: 3, edits: 8, since: '2026-03-15', pinned: false },
    };
    const md = generateCategoryMarkdown('hotspot', [hotspot]);
    assert.ok(!md.includes('**Confidence:**'));
    assert.ok(!md.includes('**Evidence:**'));
  });

  it('defaults confidence=0.5, evidence=1 when metadata has neither (AC-3 on write-path)', () => {
    const entry = makeEntry({ metadata: { source: '2026-04-01T10:00:00Z', relatedFiles: [], features: [], pinned: false } });
    const md = generateCategoryMarkdown('decision', [entry]);
    assert.ok(md.includes('- **Confidence:** 0.50'));
    assert.ok(md.includes('- **Evidence:** 1'));
  });
});

// --- AC-6: Dimmed rendering ---

describe('generateCategoryMarkdown low-confidence rendering (AC-6)', () => {
  it('wraps low-confidence entry as blockquote with "*(low confidence)*" marker', () => {
    const entry = makeEntry({ metadata: { confidence: 0.2, evidence_count: 1, relatedFiles: ['/src/auth.js'], features: [], pinned: false } });
    const md = generateCategoryMarkdown('decision', [entry]);
    assert.ok(md.includes('*(low confidence)*'), 'low-confidence marker missing');
    // Heading line must start with "> " (blockquote)
    const headingLine = md.split('\n').find((l) => l.includes('*(low confidence)*'));
    assert.ok(headingLine.startsWith('> ###'), `heading not blockquoted: ${headingLine}`);
    // Bullets are also blockquoted
    assert.ok(md.includes('> - **Date:**'));
    assert.ok(md.includes('> - **Confidence:** 0.20'));
  });

  it('boundary: confidence exactly 0.3 is NOT dimmed', () => {
    const entry = makeEntry({ metadata: { confidence: 0.3, evidence_count: 1, relatedFiles: ['/src/auth.js'], features: [], pinned: false } });
    const md = generateCategoryMarkdown('decision', [entry]);
    assert.ok(!md.includes('*(low confidence)*'));
  });

  it('does not dim high-confidence entries', () => {
    const entry = makeEntry({ metadata: { confidence: 0.95, evidence_count: 10, relatedFiles: ['/src/auth.js'], features: [], pinned: false } });
    const md = generateCategoryMarkdown('decision', [entry]);
    assert.ok(!md.includes('*(low confidence)*'));
    // Heading must NOT start with "> "
    const lines = md.split('\n');
    const heading = lines.find((l) => l.startsWith('### '));
    assert.ok(heading, 'no plain heading found for high-confidence entry');
  });
});

// --- readMemoryFile / AC-3 lazy migration + roundtrip ---

describe('readMemoryFile (AC-3 migration + roundtrip)', () => {
  it('roundtrip: writing then reading yields entries with equal core fields', () => {
    const entry = makeEntry({
      content: 'Always normalize file paths before comparison in monorepos',
      metadata: {
        source: '2026-04-01T10:00:00Z',
        relatedFiles: ['/src/path.js'],
        features: ['F-099'],
        pinned: false,
        confidence: 0.8,
        evidence_count: 4,
      },
    });
    writeMemoryDirectory(tmpDir, [entry]);
    const fp = path.join(tmpDir, MEMORY_DIR, 'decisions.md');
    const { entries } = readMemoryFile(fp);
    assert.equal(entries.length, 1);
    const got = entries[0];
    assert.equal(got.content, 'Always normalize file paths before comparison in monorepos');
    assert.equal(got.metadata.confidence, 0.8);
    assert.equal(got.metadata.evidence_count, 4);
    assert.equal(got.metadata.source, '2026-04-01');
    assert.deepEqual(got.metadata.features, ['F-099']);
    assert.deepEqual(got.metadata.relatedFiles, ['/src/path.js']);
    assert.equal(got.metadata.pinned, false);
  });

  it('migrates pre-F-055 entries without Confidence/Evidence bullets to defaults silently', () => {
    // Simulate a file written before F-055: no Confidence/Evidence lines
    const legacy = [
      '# Project Memory: Decisions',
      '',
      '> Auto-generated from code tags and session data.',
      '> Last updated: 2026-04-01',
      '',
      '### <a id="deadbeef"></a>Legacy decision from pre-F-055 memory file',
      '',
      '- **Date:** 2026-03-15 (F-050)',
      '- **Files:** `src/legacy.js`',
      '',
      '---',
      '*1 decisions total*',
    ].join('\n');
    const fp = path.join(tmpDir, 'decisions.md');
    fs.writeFileSync(fp, legacy, 'utf8');
    const { entries } = readMemoryFile(fp);
    assert.equal(entries.length, 1);
    const got = entries[0];
    assert.equal(got.content, 'Legacy decision from pre-F-055 memory file');
    assert.equal(got.metadata.confidence, 0.5, 'AC-3: default confidence');
    assert.equal(got.metadata.evidence_count, 1, 'AC-3: default evidence_count');
    assert.equal(got.metadata.source, '2026-03-15');
    assert.deepEqual(got.metadata.relatedFiles, ['src/legacy.js']);
    assert.deepEqual(got.metadata.features, ['F-050']);
  });

  it('returns empty entries list for nonexistent file', () => {
    const { entries } = readMemoryFile(path.join(tmpDir, 'nope.md'));
    assert.deepEqual(entries, []);
  });

  it('parses dimmed (low-confidence) entries correctly, stripping the marker', () => {
    const entry = makeEntry({
      content: 'Tentative rule about cache TTL defaults',
      metadata: {
        source: '2026-04-01T10:00:00Z',
        relatedFiles: ['/src/cache.js'],
        features: [],
        pinned: false,
        confidence: 0.1,
        evidence_count: 1,
      },
    });
    writeMemoryDirectory(tmpDir, [entry]);
    const fp = path.join(tmpDir, MEMORY_DIR, 'decisions.md');
    const { entries } = readMemoryFile(fp);
    assert.equal(entries.length, 1);
    // Content must not carry the dim marker
    assert.equal(entries[0].content, 'Tentative rule about cache TTL defaults');
    assert.equal(entries[0].metadata.confidence, 0.1);
  });

  it('preserves pinned flag when parsing', () => {
    const entry = makeEntry({
      content: 'Pinned critical decision about database locking semantics',
      metadata: {
        source: '2026-04-01T10:00:00Z',
        relatedFiles: ['/src/db.js'],
        features: [],
        pinned: true,
        confidence: 0.9,
        evidence_count: 5,
      },
    });
    writeMemoryDirectory(tmpDir, [entry]);
    const fp = path.join(tmpDir, MEMORY_DIR, 'decisions.md');
    const { entries } = readMemoryFile(fp);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].metadata.pinned, true);
    assert.equal(entries[0].content, 'Pinned critical decision about database locking semantics');
  });

  it('handles cross-cutting entries (Files: cross-cutting)', () => {
    const entry = makeEntry({
      content: 'Project-wide rule about commit-message formatting conventions',
      file: null,
      metadata: {
        source: '2026-04-01T10:00:00Z',
        relatedFiles: [],
        features: [],
        pinned: false,
        confidence: 0.7,
        evidence_count: 2,
      },
    });
    writeMemoryDirectory(tmpDir, [entry]);
    const fp = path.join(tmpDir, MEMORY_DIR, 'decisions.md');
    const { entries } = readMemoryFile(fp);
    assert.equal(entries.length, 1);
    assert.deepEqual(entries[0].metadata.relatedFiles, []);
  });
});

// --- Hotspots are unaffected ---

describe('hotspots remain unchanged (no Confidence/Evidence bullets)', () => {
  it('writeMemoryDirectory produces hotspots.md without Confidence/Evidence columns', () => {
    const hotspot = {
      category: 'hotspot',
      file: '/src/auth.js',
      content: 'Frequently modified',
      metadata: { sessions: 3, edits: 8, since: '2026-03-15', pinned: false, source: '2026-04-01T10:00:00Z' },
    };
    writeMemoryDirectory(tmpDir, [hotspot]);
    const body = fs.readFileSync(path.join(tmpDir, MEMORY_DIR, 'hotspots.md'), 'utf8');
    assert.ok(!body.includes('**Confidence:**'));
    assert.ok(!body.includes('**Evidence:**'));
    assert.ok(body.includes('| Rank |'));
  });
});
