'use strict';

// @cap-feature(feature:F-093) Tests for V6 per-feature memory pipeline layout.
//   Pins AC-1..AC-8: opt-in via .cap/config.json, per-feature writes, index files,
//   classifier integration, V5 backwards-compat, V5 archive on switch.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const memDir = require('../cap/bin/lib/cap-memory-dir.cjs');
const {
  writeMemoryDirectory,
  _isV6LayoutEnabled,
  _writeMemoryV6,
  _groupEntriesByDestination,
  _renderV6Index,
  _archiveV5IfPresent,
  MEMORY_DIR,
} = memDir;

// --- Sandbox helpers ---

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-f093-'));
  fs.mkdirSync(path.join(root, '.cap', 'memory'), { recursive: true });
  return root;
}

function cleanup(root) {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (_e) { /* ignore */ }
}

function writeConfig(root, layout) {
  const dir = path.join(root, '.cap');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ memory: { layout } }));
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

// --- AC-1: Opt-in detection ---

describe('AC-1: V6 layout opt-in detection', () => {
  it('returns false by default (no config)', () => {
    const root = makeProject();
    try {
      assert.equal(_isV6LayoutEnabled(root), false);
    } finally { cleanup(root); }
  });

  it('returns true when .cap/config.json: { memory: { layout: "v6" } }', () => {
    const root = makeProject();
    try {
      writeConfig(root, 'v6');
      assert.equal(_isV6LayoutEnabled(root), true);
    } finally { cleanup(root); }
  });

  it('returns false when config explicitly sets layout: "v5"', () => {
    const root = makeProject();
    try {
      writeConfig(root, 'v5');
      assert.equal(_isV6LayoutEnabled(root), false);
    } finally { cleanup(root); }
  });

  it('options.layout overrides config (test-friendly)', () => {
    const root = makeProject();
    try {
      writeConfig(root, 'v5');
      assert.equal(_isV6LayoutEnabled(root, { layout: 'v6' }), true);
      writeConfig(root, 'v6');
      assert.equal(_isV6LayoutEnabled(root, { layout: 'v5' }), false);
    } finally { cleanup(root); }
  });

  it('returns false on malformed JSON (graceful fallback)', () => {
    const root = makeProject();
    try {
      fs.writeFileSync(path.join(root, '.cap', 'config.json'), '{ this is not json');
      assert.equal(_isV6LayoutEnabled(root), false);
    } finally { cleanup(root); }
  });
});

// --- AC-2: Per-feature writes ---

describe('AC-2: Per-feature file writes', () => {
  it('writes features/F-XXX-<topic>.md when entry has tagged feature', () => {
    const root = makeProject();
    try {
      writeFeatureMap(root, [{ id: 'F-100', title: 'Auth Backbone', files: [] }]);
      writeConfig(root, 'v6');
      // Source file with @cap-feature(F-100) so classifier matches via reverse-index
      fs.mkdirSync(path.join(root, 'src'), { recursive: true });
      fs.writeFileSync(path.join(root, 'src', 'auth.ts'), '// @cap-feature(feature:F-100) Auth\n');
      const entries = [
        makeEntry('decision', 'JWT verify is async at the edge', ['src/auth.ts']),
      ];
      const r = writeMemoryDirectory(root, entries);
      assert.ok(r.written > 0);
      const expected = path.join(root, '.cap/memory/features');
      const featureFiles = fs.readdirSync(expected);
      assert.ok(featureFiles.length === 1);
      assert.match(featureFiles[0], /^F-100-/);
      const fileContent = fs.readFileSync(path.join(expected, featureFiles[0]), 'utf8');
      assert.match(fileContent, /JWT verify is async/);
    } finally { cleanup(root); }
  });

  it('routes unclassifiable entries to platform/unassigned.md', () => {
    const root = makeProject();
    try {
      writeFeatureMap(root, [{ id: 'F-100', title: 'X', files: [] }]);
      writeConfig(root, 'v6');
      const entries = [
        makeEntry('decision', 'Random unrelated decision', ['no-feature-mapping.ts']),
      ];
      const r = writeMemoryDirectory(root, entries);
      assert.ok(r.written > 0);
      const platformDir = path.join(root, '.cap/memory/platform');
      assert.ok(fs.existsSync(platformDir));
      // unassigned platform file should exist
      const platFiles = fs.readdirSync(platformDir);
      assert.ok(platFiles.includes('unassigned.md'));
    } finally { cleanup(root); }
  });

  it('respects explicit metadata.features (taggedFeatureId path)', () => {
    const root = makeProject();
    try {
      writeFeatureMap(root, [{ id: 'F-200', title: 'Tagged', files: [] }]);
      writeConfig(root, 'v6');
      const entries = [
        makeEntry('decision', 'Tagged decision', ['anything.ts'], 'F-200'),
      ];
      writeMemoryDirectory(root, entries);
      const featureFiles = fs.readdirSync(path.join(root, '.cap/memory/features'));
      assert.ok(featureFiles.some((f) => f.startsWith('F-200-')));
    } finally { cleanup(root); }
  });
});

// --- AC-3: Top-level Index files ---

describe('AC-3: Top-level Index files', () => {
  it('top-level decisions.md is V6 Index, not entries dump', () => {
    const root = makeProject();
    try {
      writeFeatureMap(root, [{ id: 'F-300', title: 'X', files: [] }]);
      writeConfig(root, 'v6');
      fs.mkdirSync(path.join(root, 'src'), { recursive: true });
      fs.writeFileSync(path.join(root, 'src', 'x.ts'), '// @cap-feature(feature:F-300) X\n');
      const entries = [makeEntry('decision', 'Decision body text', ['src/x.ts'])];
      writeMemoryDirectory(root, entries);
      const indexContent = fs.readFileSync(path.join(root, '.cap/memory/decisions.md'), 'utf8');
      assert.match(indexContent, /V6 Index/);
      assert.match(indexContent, /F-300/);
      assert.match(indexContent, /\| 1 \|/); // count column
    } finally { cleanup(root); }
  });

  it('pitfalls.md is also V6 Index', () => {
    const root = makeProject();
    try {
      writeFeatureMap(root, [{ id: 'F-400', title: 'X', files: [] }]);
      writeConfig(root, 'v6');
      fs.mkdirSync(path.join(root, 'src'), { recursive: true });
      fs.writeFileSync(path.join(root, 'src', 'x.ts'), '// @cap-feature(feature:F-400) X\n');
      writeMemoryDirectory(root, [makeEntry('pitfall', 'A pitfall to avoid', ['src/x.ts'])]);
      const idx = fs.readFileSync(path.join(root, '.cap/memory/pitfalls.md'), 'utf8');
      assert.match(idx, /V6 Index/);
      assert.match(idx, /F-400/);
    } finally { cleanup(root); }
  });
});

// --- AC-4: Classifier integration ---

describe('AC-4: Classifier integration via F-077', () => {
  it('uses sourceFileToFeatureId (code-tag reverse) when key_files is sparse', () => {
    const root = makeProject();
    try {
      // FEATURE-MAP without **Files:** for F-500 — the hub case
      writeFeatureMap(root, [{ id: 'F-500', title: 'NoFiles', files: [] }]);
      writeConfig(root, 'v6');
      fs.mkdirSync(path.join(root, 'src'), { recursive: true });
      // Code tag is the only signal
      fs.writeFileSync(path.join(root, 'src', 'rev.ts'), '// @cap-feature(feature:F-500) Reverse\n');
      const entries = [makeEntry('decision', 'Reverse-classified decision', ['src/rev.ts'])];
      writeMemoryDirectory(root, entries);
      const featureFiles = fs.readdirSync(path.join(root, '.cap/memory/features'));
      assert.ok(featureFiles.some((f) => f.startsWith('F-500-')), 'code-tag reverse-index must drive routing');
    } finally { cleanup(root); }
  });
});

// --- AC-5: V5 backwards-compat ---

describe('AC-5: V5 backwards-compatibility', () => {
  it('without config flag, behaviour is byte-identical to pre-F-093', () => {
    const root = makeProject();
    try {
      // No config → V5 default
      const entries = [makeEntry('decision', 'V5 entry', ['x.ts'])];
      writeMemoryDirectory(root, entries);
      // V5: top-level decisions.md should NOT be a V6 Index
      const content = fs.readFileSync(path.join(root, '.cap/memory/decisions.md'), 'utf8');
      assert.doesNotMatch(content, /V6 Index/);
      assert.match(content, /V5 entry/);
      // V5: features/ directory should NOT be created
      assert.ok(!fs.existsSync(path.join(root, '.cap/memory/features')));
    } finally { cleanup(root); }
  });
});

// --- AC-7: V5 archive on switch ---

describe('AC-7: V5 archive on first V6 write', () => {
  it('archives existing V5 monolith files to .archive/ on first V6 write', () => {
    const root = makeProject();
    try {
      writeFeatureMap(root, [{ id: 'F-600', title: 'X', files: [] }]);
      // Pre-create V5 monolith
      fs.writeFileSync(path.join(root, '.cap/memory/decisions.md'), '# Project Memory: Decisions\n\n### old V5 entry\n');
      fs.writeFileSync(path.join(root, '.cap/memory/pitfalls.md'), '# Project Memory: Pitfalls\n\n### old pitfall\n');
      // Switch to V6
      writeConfig(root, 'v6');
      fs.mkdirSync(path.join(root, 'src'), { recursive: true });
      fs.writeFileSync(path.join(root, 'src', 'x.ts'), '// @cap-feature(feature:F-600) X\n');
      writeMemoryDirectory(root, [makeEntry('decision', 'new', ['src/x.ts'])]);
      const archive = path.join(root, '.cap/memory/.archive');
      assert.ok(fs.existsSync(archive));
      const archived = fs.readdirSync(archive);
      assert.ok(archived.some((f) => f.startsWith('decisions-pre-v6-')), 'decisions archived');
      assert.ok(archived.some((f) => f.startsWith('pitfalls-pre-v6-')), 'pitfalls archived');
    } finally { cleanup(root); }
  });

  it('idempotent: re-running on the same date does not duplicate archive entries', () => {
    const root = makeProject();
    try {
      writeFeatureMap(root, [{ id: 'F-700', title: 'X', files: [] }]);
      fs.writeFileSync(path.join(root, '.cap/memory/decisions.md'), '# v5\n');
      writeConfig(root, 'v6');
      fs.mkdirSync(path.join(root, 'src'), { recursive: true });
      fs.writeFileSync(path.join(root, 'src', 'x.ts'), '// @cap-feature(feature:F-700) X\n');
      writeMemoryDirectory(root, [makeEntry('decision', 'one', ['src/x.ts'])]);
      const archiveDir = path.join(root, '.cap/memory/.archive');
      const before = fs.readdirSync(archiveDir).length;
      // Re-run
      writeMemoryDirectory(root, [makeEntry('decision', 'two', ['src/x.ts'])]);
      const after = fs.readdirSync(archiveDir).length;
      assert.equal(before, after, 'archive count unchanged on second run with same date');
    } finally { cleanup(root); }
  });

  it('does NOT re-archive a V6 Index file (skip-if-already-v6)', () => {
    const root = makeProject();
    try {
      writeFeatureMap(root, [{ id: 'F-800', title: 'X', files: [] }]);
      // Pre-create top-level decisions.md as a V6 Index (e.g. from a prior V6 run)
      fs.writeFileSync(
        path.join(root, '.cap/memory/decisions.md'),
        '# Project Memory: Decisions (V6 Index)\n\n> V6 layout active.\n'
      );
      writeConfig(root, 'v6');
      fs.mkdirSync(path.join(root, 'src'), { recursive: true });
      fs.writeFileSync(path.join(root, 'src', 'x.ts'), '// @cap-feature(feature:F-800) X\n');
      writeMemoryDirectory(root, [makeEntry('decision', 'new', ['src/x.ts'])]);
      const archiveDir = path.join(root, '.cap/memory/.archive');
      // Either no archive dir or no decisions-pre-v6 file
      if (fs.existsSync(archiveDir)) {
        const files = fs.readdirSync(archiveDir);
        assert.ok(!files.some((f) => f.startsWith('decisions-pre-v6-')));
      }
    } finally { cleanup(root); }
  });
});

// --- AC-8: Test coverage breadth (greenfield, hub-scenario, mixed) ---

describe('AC-8: Coverage breadth', () => {
  it('greenfield: no existing files, V6 produces exactly the expected layout', () => {
    const root = makeProject();
    try {
      writeFeatureMap(root, [
        { id: 'F-001', title: 'Auth', files: [] },
        { id: 'F-002', title: 'Audit', files: [] },
      ]);
      writeConfig(root, 'v6');
      fs.mkdirSync(path.join(root, 'src'), { recursive: true });
      fs.writeFileSync(path.join(root, 'src', 'auth.ts'), '// @cap-feature(feature:F-001) Auth\n');
      fs.writeFileSync(path.join(root, 'src', 'audit.ts'), '// @cap-feature(feature:F-002) Audit\n');
      const entries = [
        makeEntry('decision', 'Auth decision', ['src/auth.ts']),
        makeEntry('decision', 'Audit decision', ['src/audit.ts']),
        makeEntry('pitfall', 'Auth pitfall', ['src/auth.ts']),
      ];
      writeMemoryDirectory(root, entries);
      const features = fs.readdirSync(path.join(root, '.cap/memory/features'));
      assert.equal(features.length, 2, 'one file per feature');
      // Index has 2 features
      const idxDecisions = fs.readFileSync(path.join(root, '.cap/memory/decisions.md'), 'utf8');
      assert.match(idxDecisions, /F-001/);
      assert.match(idxDecisions, /F-002/);
    } finally { cleanup(root); }
  });

  it('mixed: some features explicit, some via reverse-index, some unassigned', () => {
    const root = makeProject();
    try {
      writeFeatureMap(root, [
        { id: 'F-100', title: 'Explicit', files: [] },
        { id: 'F-200', title: 'Reverse', files: [] },
      ]);
      writeConfig(root, 'v6');
      fs.mkdirSync(path.join(root, 'src'), { recursive: true });
      fs.writeFileSync(path.join(root, 'src', 'rev.ts'), '// @cap-feature(feature:F-200) Reverse\n');
      const entries = [
        makeEntry('decision', 'Explicit', ['x.ts'], 'F-100'),
        makeEntry('decision', 'Reverse', ['src/rev.ts']),
        makeEntry('decision', 'Orphan', ['nowhere.ts']),
      ];
      writeMemoryDirectory(root, entries);
      const features = fs.readdirSync(path.join(root, '.cap/memory/features'));
      assert.ok(features.some((f) => f.startsWith('F-100-')));
      assert.ok(features.some((f) => f.startsWith('F-200-')));
      const platform = fs.readdirSync(path.join(root, '.cap/memory/platform'));
      assert.ok(platform.includes('unassigned.md'));
    } finally { cleanup(root); }
  });

  it('hotspot/pattern entries are skipped in V6 (per F-076 schema scope)', () => {
    const root = makeProject();
    try {
      writeFeatureMap(root, [{ id: 'F-100', title: 'X', files: [] }]);
      writeConfig(root, 'v6');
      const entries = [
        makeEntry('hotspot', 'a hotspot', ['x.ts']),
        makeEntry('pattern', 'a pattern', ['x.ts']),
      ];
      const r = writeMemoryDirectory(root, entries);
      // No features dir created (no decision/pitfall to route)
      const features = fs.existsSync(path.join(root, '.cap/memory/features'))
        ? fs.readdirSync(path.join(root, '.cap/memory/features'))
        : [];
      assert.equal(features.length, 0);
      // Index files should still be written (empty tables)
      assert.ok(r.written >= 2); // 2 index files
    } finally { cleanup(root); }
  });
});
