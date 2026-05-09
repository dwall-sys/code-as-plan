'use strict';

// @cap-feature(feature:F-095) Tests for Memory Layout-Switch Activation CLI.
//   Pins AC-1..AC-5: switchLayout liest existing V5 entries, persistiert config.json,
//   ruft writeMemoryDirectory mit V6-dispatch. Atomicity (write-then-rollback),
//   Idempotency (V6→V6 noop), Reporting (sourceEntries/written/archives).

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const memDir = require('../cap/bin/lib/cap-memory-dir.cjs');
const { switchLayout, writeMemoryDirectory, MEMORY_DIR, CATEGORY_FILES } = memDir;

// --- Sandbox helpers ---

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-f095-'));
  fs.mkdirSync(path.join(root, '.cap', 'memory'), { recursive: true });
  return root;
}

function cleanup(root) {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (_e) { /* ignore */ }
}

function writeFeatureMap(root, features) {
  const blocks = features.map((f) => {
    const filesBlock = (f.files || []).map((p) => `- \`${p}\``).join('\n');
    return `### ${f.id}: ${f.title} [${f.state || 'shipped'}]\n\n| AC | Status | Description |\n|----|--------|-------------|\n| AC-1 | tested | x |\n\n**Files:**\n${filesBlock}\n`;
  }).join('\n');
  fs.writeFileSync(path.join(root, 'FEATURE-MAP.md'), `# Feature Map\n\n## Features\n\n${blocks}\n`);
}

function makeEntry(category, content, files, taggedFeature) {
  return {
    category,
    file: files && files[0] ? files[0] : '',
    content,
    metadata: {
      source: 'code',
      relatedFiles: files || [],
      features: taggedFeature ? [taggedFeature] : [],
      pinned: false,
      confidence: 0.8,
      evidence_count: 1,
      last_seen: '2026-05-08',
    },
  };
}

function seedV5Monolith(root, entries) {
  // Write V5 monolith via the legacy path (no V6 config flag, no override).
  return writeMemoryDirectory(root, entries, {});
}

// --- AC-1: Basic V5→V6 switch ---

describe('F-095/AC-1: switchLayout reads existing V5 entries and writes V6', () => {
  it('greenfield V5 monolith → V6 with entries classified', () => {
    const root = makeProject();
    try {
      writeFeatureMap(root, [{ id: 'F-100', title: 'Auth Backbone', files: ['src/auth.js'] }]);
      const entries = [
        makeEntry('decision', 'Use JWT with rotating refresh tokens', ['src/auth.js'], 'F-100'),
        makeEntry('pitfall', 'Token leaks via console.log break audit', ['src/auth.js'], 'F-100'),
      ];
      seedV5Monolith(root, entries);
      // Sanity: V5 monolith present (no V6 marker).
      const decFile = path.join(root, MEMORY_DIR, CATEGORY_FILES.decision);
      assert.ok(fs.existsSync(decFile));
      assert.equal(fs.readFileSync(decFile, 'utf8').includes('(V6 Index)'), false);

      const result = switchLayout(root, 'v6');

      assert.equal(result.status, 'switched');
      assert.equal(result.target, 'v6');
      assert.equal(result.sourceEntries, 2);
      assert.ok(result.written > 0);

      // V6 marker now present.
      const decAfter = fs.readFileSync(decFile, 'utf8');
      assert.ok(decAfter.includes('(V6 Index)'), 'top-level decisions.md should be V6 Index');

      const pitFile = path.join(root, MEMORY_DIR, CATEGORY_FILES.pitfall);
      assert.ok(fs.readFileSync(pitFile, 'utf8').includes('(V6 Index)'));

      // Per-feature file written.
      const featuresDir = path.join(root, MEMORY_DIR, 'features');
      const featureFiles = fs.readdirSync(featuresDir).filter(f => f.startsWith('F-100-'));
      assert.equal(featureFiles.length, 1);
    } finally { cleanup(root); }
  });

  it('reads both decisions and pitfalls sources', () => {
    const root = makeProject();
    try {
      writeFeatureMap(root, [{ id: 'F-200', title: 'Storage', files: ['s.js'] }]);
      const entries = [
        makeEntry('decision', 'A', ['s.js'], 'F-200'),
        makeEntry('decision', 'B', ['s.js'], 'F-200'),
        makeEntry('decision', 'C', ['s.js'], 'F-200'),
        makeEntry('pitfall', 'P1', ['s.js'], 'F-200'),
        makeEntry('pitfall', 'P2', ['s.js'], 'F-200'),
      ];
      seedV5Monolith(root, entries);

      const result = switchLayout(root, 'v6');
      assert.equal(result.sourceEntries, 5, 'should sum decisions + pitfalls');
    } finally { cleanup(root); }
  });
});

// --- AC-2: Atomicity (write-then-rollback) ---

describe('F-095/AC-2: write-then-rollback atomicity', () => {
  it('persists config.json only after writeMemoryDirectory succeeds', () => {
    const root = makeProject();
    try {
      writeFeatureMap(root, [{ id: 'F-300', title: 'X', files: [] }]);
      seedV5Monolith(root, [makeEntry('decision', 'd', [], 'F-300')]);

      assert.equal(fs.existsSync(path.join(root, '.cap', 'config.json')), false);
      switchLayout(root, 'v6');
      assert.ok(fs.existsSync(path.join(root, '.cap', 'config.json')));
      const cfg = JSON.parse(fs.readFileSync(path.join(root, '.cap', 'config.json'), 'utf8'));
      assert.equal(cfg.memory.layout, 'v6');
    } finally { cleanup(root); }
  });

  it('on writeMemoryDirectory error: config.json NOT written', () => {
    const root = makeProject();
    try {
      writeFeatureMap(root, [{ id: 'F-301', title: 'Y', files: ['s.js'] }]);
      seedV5Monolith(root, [makeEntry('decision', 'd', ['s.js'], 'F-301')]);

      // Sabotage: replace features/ with a file so _writeV6FeatureFile's mkdirSync throws ENOTDIR.
      const featuresPath = path.join(root, MEMORY_DIR, 'features');
      fs.writeFileSync(featuresPath, 'sabotage');

      assert.throws(() => switchLayout(root, 'v6'));
      assert.equal(
        fs.existsSync(path.join(root, '.cap', 'config.json')),
        false,
        'config.json must not be persisted when writeMemoryDirectory throws',
      );
    } finally { cleanup(root); }
  });
});

// --- AC-3: Idempotency ---

describe('F-095/AC-3: V6→V6 idempotency', () => {
  it('second switchLayout call is a no-op (returns status:noop)', () => {
    const root = makeProject();
    try {
      writeFeatureMap(root, [{ id: 'F-400', title: 'Q', files: [] }]);
      seedV5Monolith(root, [makeEntry('decision', 'd1', [], 'F-400')]);

      const first = switchLayout(root, 'v6');
      assert.equal(first.status, 'switched');

      const second = switchLayout(root, 'v6');
      assert.equal(second.status, 'noop');
      assert.equal(second.sourceEntries, 0);
      assert.equal(second.written, 0);
    } finally { cleanup(root); }
  });

  it('noop preserves V6 index file byte-identical', () => {
    const root = makeProject();
    try {
      writeFeatureMap(root, [{ id: 'F-401', title: 'R', files: [] }]);
      seedV5Monolith(root, [makeEntry('decision', 'd', [], 'F-401')]);

      switchLayout(root, 'v6');
      const decBefore = fs.readFileSync(path.join(root, MEMORY_DIR, CATEGORY_FILES.decision), 'utf8');

      switchLayout(root, 'v6'); // noop
      const decAfter = fs.readFileSync(path.join(root, MEMORY_DIR, CATEGORY_FILES.decision), 'utf8');

      assert.equal(decAfter, decBefore, 'V6 index file unchanged after noop switchLayout');
    } finally { cleanup(root); }
  });
});

// --- AC-4: Reporting ---

describe('F-095/AC-4: reporting payload', () => {
  it('returns sourceEntries, written, configPath, archives', () => {
    const root = makeProject();
    try {
      writeFeatureMap(root, [{ id: 'F-500', title: 'S', files: ['s.js'] }]);
      seedV5Monolith(root, [
        makeEntry('decision', 'a', ['s.js'], 'F-500'),
        makeEntry('pitfall', 'p', ['s.js'], 'F-500'),
      ]);

      const result = switchLayout(root, 'v6');

      assert.equal(typeof result.sourceEntries, 'number');
      assert.equal(typeof result.written, 'number');
      assert.equal(typeof result.configPath, 'string');
      assert.ok(result.configPath.endsWith('config.json'));
      assert.ok(Array.isArray(result.archives));
      // Archives directory was populated by _archiveV5IfPresent during writeMemoryDirectory.
      assert.ok(result.archives.length > 0, 'expected V5 backup archives to be reported');
    } finally { cleanup(root); }
  });
});

// --- AC-5: edge cases & rejection ---

describe('F-095/AC-5: edge cases', () => {
  it('throws on unsupported target', () => {
    const root = makeProject();
    try {
      assert.throws(() => switchLayout(root, 'v7'), /unsupported target/);
      assert.throws(() => switchLayout(root, 'v5'), /unsupported target/);
    } finally { cleanup(root); }
  });

  it('handles project with no existing V5 files (greenfield)', () => {
    const root = makeProject();
    try {
      writeFeatureMap(root, [{ id: 'F-600', title: 'T', files: [] }]);
      // No seedV5Monolith — fresh memory dir.
      const result = switchLayout(root, 'v6');
      assert.equal(result.status, 'switched');
      assert.equal(result.sourceEntries, 0);
    } finally { cleanup(root); }
  });

  it('merges with existing config.json (preserves other keys)', () => {
    const root = makeProject();
    try {
      writeFeatureMap(root, [{ id: 'F-700', title: 'U', files: [] }]);
      seedV5Monolith(root, [makeEntry('decision', 'd', [], 'F-700')]);
      // Existing config with unrelated key.
      fs.writeFileSync(
        path.join(root, '.cap', 'config.json'),
        JSON.stringify({ otherKey: 'preserved', memory: { otherMemKey: 'kept' } }),
      );

      switchLayout(root, 'v6');

      const cfg = JSON.parse(fs.readFileSync(path.join(root, '.cap', 'config.json'), 'utf8'));
      assert.equal(cfg.otherKey, 'preserved');
      assert.equal(cfg.memory.otherMemKey, 'kept');
      assert.equal(cfg.memory.layout, 'v6');
    } finally { cleanup(root); }
  });

  it('overwrites existing memory.layout when set to a different value', () => {
    const root = makeProject();
    try {
      writeFeatureMap(root, [{ id: 'F-701', title: 'V', files: [] }]);
      seedV5Monolith(root, [makeEntry('decision', 'd', [], 'F-701')]);
      fs.writeFileSync(
        path.join(root, '.cap', 'config.json'),
        JSON.stringify({ memory: { layout: 'v5' } }),
      );

      switchLayout(root, 'v6');

      const cfg = JSON.parse(fs.readFileSync(path.join(root, '.cap', 'config.json'), 'utf8'));
      assert.equal(cfg.memory.layout, 'v6');
    } finally { cleanup(root); }
  });

  it('creates .cap/ directory if missing (defense in depth)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-f095-bare-'));
    try {
      // No .cap at all → writeMemoryDirectory will create memory/ as needed.
      // switchLayout should also handle missing .cap/ gracefully.
      writeFeatureMap(root, [{ id: 'F-800', title: 'W', files: [] }]);

      const result = switchLayout(root, 'v6');
      assert.equal(result.status, 'switched');
      assert.ok(fs.existsSync(path.join(root, '.cap', 'config.json')));
    } finally { cleanup(root); }
  });
});
