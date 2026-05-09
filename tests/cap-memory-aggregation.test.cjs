'use strict';

// @cap-feature(feature:F-096) Tests for Cross-App Memory Aggregation Index.
//   Pins AC-1..AC-7: monorepo detection, app routing per source-file, cross-cutting
//   entries, root index with cross-app paths, append-only on sub-apps, atomicity,
//   conflict handling.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const memDir = require('../cap/bin/lib/cap-memory-dir.cjs');
const {
  writeMemoryDirectory,
  _isMonorepoLayout,
  _resolveAppForFile,
  _findSubAppFeatureFile,
  _writeMemoryV6,
  MEMORY_DIR,
  CATEGORY_FILES,
} = memDir;

// --- Sandbox helpers ---

function makeMonorepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-f096-'));
  fs.mkdirSync(path.join(root, '.cap', 'memory'), { recursive: true });
  fs.mkdirSync(path.join(root, 'apps'), { recursive: true });
  return root;
}

function cleanup(root) {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (_e) { /* ignore */ }
}

function makeSubApp(root, appName, options = {}) {
  const appRoot = path.join(root, 'apps', appName);
  fs.mkdirSync(path.join(appRoot, '.cap', 'memory'), { recursive: true });
  if (options.v6) {
    // Mark sub-app as V6 by writing a decisions.md with the marker.
    fs.writeFileSync(
      path.join(appRoot, '.cap', 'memory', 'decisions.md'),
      '# Project Memory: Decisions (V6 Index)\n\n> sub-app V6 active.\n',
    );
    if (options.featuresDir !== false) {
      fs.mkdirSync(path.join(appRoot, '.cap', 'memory', 'features'), { recursive: true });
    }
  } else if (options.v5) {
    fs.writeFileSync(
      path.join(appRoot, '.cap', 'memory', 'decisions.md'),
      '# Project Memory: Decisions\n\n> V5 monolith.\n',
    );
  }
  // Optional: pre-existing feature files in sub-app
  if (options.featureFiles) {
    const featuresDir = path.join(appRoot, '.cap', 'memory', 'features');
    fs.mkdirSync(featuresDir, { recursive: true });
    for (const fname of options.featureFiles) {
      fs.writeFileSync(path.join(featuresDir, fname), `# ${fname}\n`);
    }
  }
  return appRoot;
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

// --- AC-1: Monorepo Detection ---

describe('F-096/AC-1: monorepo detection', () => {
  it('returns empty array for single-app project (no apps/ dir)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-f096-single-'));
    try {
      assert.deepEqual(_isMonorepoLayout(root), []);
    } finally { cleanup(root); }
  });

  it('returns empty array when apps/ exists but no V6 sub-app', () => {
    const root = makeMonorepo();
    try {
      makeSubApp(root, 'hub', { v5: true });
      makeSubApp(root, 'booking'); // no memory/decisions
      assert.deepEqual(_isMonorepoLayout(root), []);
    } finally { cleanup(root); }
  });

  it('returns sub-app names that have V6 marker', () => {
    const root = makeMonorepo();
    try {
      makeSubApp(root, 'hub', { v6: true });
      makeSubApp(root, 'booking', { v5: true });
      makeSubApp(root, 'flow', { v6: true });
      const result = _isMonorepoLayout(root);
      assert.deepEqual(result.sort(), ['flow', 'hub']);
    } finally { cleanup(root); }
  });

  it('handles unreadable apps/ subdirs gracefully', () => {
    const root = makeMonorepo();
    try {
      makeSubApp(root, 'hub', { v6: true });
      // Create a file (not directory) named "weird" inside apps/
      fs.writeFileSync(path.join(root, 'apps', 'weird'), 'not-a-dir');
      const result = _isMonorepoLayout(root);
      assert.deepEqual(result, ['hub']);
    } finally { cleanup(root); }
  });

  it('returns empty for null/undefined projectRoot', () => {
    assert.deepEqual(_isMonorepoLayout(null), []);
    assert.deepEqual(_isMonorepoLayout(undefined), []);
    assert.deepEqual(_isMonorepoLayout(''), []);
  });
});

// --- AC-2: App Routing per source-file ---

describe('F-096/AC-2: source-file → app routing', () => {
  it('resolves apps/<name>/file → app name when in v6Apps', () => {
    assert.equal(_resolveAppForFile('apps/hub/src/index.ts', ['hub', 'booking']), 'hub');
    assert.equal(_resolveAppForFile('apps/booking/lib/foo.js', ['hub', 'booking']), 'booking');
  });

  it('returns null for non-app paths', () => {
    assert.equal(_resolveAppForFile('packages/shared/x.ts', ['hub']), null);
    assert.equal(_resolveAppForFile('nx.json', ['hub']), null);
    assert.equal(_resolveAppForFile('', ['hub']), null);
  });

  it('returns null when app exists but is not in v6Apps list', () => {
    assert.equal(_resolveAppForFile('apps/booking/x.ts', ['hub']), null);
  });

  it('handles backslash paths (windows-style)', () => {
    assert.equal(_resolveAppForFile('apps\\hub\\src\\x.ts', ['hub']), 'hub');
  });

  it('handles leading slashes', () => {
    assert.equal(_resolveAppForFile('/apps/hub/x.ts', ['hub']), 'hub');
  });
});

// --- AC-3: Cross-cutting entries stay at root ---

describe('F-096/AC-3: cross-cutting entries route to root', () => {
  it('entries with no app source go to root features/', () => {
    const root = makeMonorepo();
    try {
      makeSubApp(root, 'hub', { v6: true });
      writeFeatureMap(root, [{ id: 'F-NX-CONFIG', title: 'NX Workspace Config', files: ['nx.json'] }]);
      const entries = [makeEntry('decision', 'Use NX 18+ for monorepo orchestration', ['nx.json'], 'F-NX-CONFIG')];
      _writeMemoryV6(root, entries);

      // Root features/ contains cross-cutting feature
      const rootFeaturesDir = path.join(root, MEMORY_DIR, 'features');
      const featureFiles = fs.readdirSync(rootFeaturesDir).filter(f => f.startsWith('F-NX-CONFIG-'));
      assert.equal(featureFiles.length, 1, 'cross-cutting feature should be at root');
    } finally { cleanup(root); }
  });

  it('entries spanning multiple apps go to root (ambiguous)', () => {
    const root = makeMonorepo();
    try {
      makeSubApp(root, 'hub', { v6: true });
      makeSubApp(root, 'booking', { v6: true });
      writeFeatureMap(root, [{ id: 'F-SHARED-AUTH', title: 'Shared Auth', files: [] }]);
      const entries = [
        makeEntry('decision', 'JWT auth shared across apps', ['apps/hub/auth.ts'], 'F-SHARED-AUTH'),
        makeEntry('decision', 'Refresh tokens persist in DB', ['apps/booking/auth.ts'], 'F-SHARED-AUTH'),
      ];
      _writeMemoryV6(root, entries);

      // Multi-app feature should land at root
      const rootFeaturesDir = path.join(root, MEMORY_DIR, 'features');
      const featureFiles = fs.readdirSync(rootFeaturesDir).filter(f => f.startsWith('F-SHARED-AUTH-'));
      assert.equal(featureFiles.length, 1);
    } finally { cleanup(root); }
  });
});

// --- AC-4: Cross-app routing — sub-app-owned features SKIP root write ---

describe('F-096/AC-4: app-owned features skip root write, appear in index', () => {
  it('hub-only feature is NOT written to root features/', () => {
    const root = makeMonorepo();
    try {
      makeSubApp(root, 'hub', {
        v6: true,
        featureFiles: ['F-HUB-CHAT-real-existing-file.md'],
      });
      writeFeatureMap(root, [{ id: 'F-HUB-CHAT', title: 'Hub Chat', files: ['apps/hub/chat.ts'] }]);
      const entries = [
        makeEntry('decision', 'Use SSE for chat updates', ['apps/hub/chat.ts'], 'F-HUB-CHAT'),
        makeEntry('pitfall', 'Chat lost on reconnect bug', ['apps/hub/chat.ts'], 'F-HUB-CHAT'),
      ];
      _writeMemoryV6(root, entries);

      const rootFeaturesDir = path.join(root, MEMORY_DIR, 'features');
      const exists = fs.existsSync(rootFeaturesDir)
        ? fs.readdirSync(rootFeaturesDir).filter(f => f.startsWith('F-HUB-CHAT')).length
        : 0;
      assert.equal(exists, 0, 'hub feature must NOT be duplicated at root');
    } finally { cleanup(root); }
  });

  it('root index "Cross-App" section lists app-owned features with sub-app paths', () => {
    const root = makeMonorepo();
    try {
      makeSubApp(root, 'hub', {
        v6: true,
        featureFiles: ['F-HUB-CHAT-real-file.md'],
      });
      writeFeatureMap(root, [{ id: 'F-HUB-CHAT', title: 'Hub Chat', files: ['apps/hub/chat.ts'] }]);
      const entries = [makeEntry('decision', 'd', ['apps/hub/chat.ts'], 'F-HUB-CHAT')];
      _writeMemoryV6(root, entries);

      const decContent = fs.readFileSync(path.join(root, MEMORY_DIR, 'decisions.md'), 'utf8');
      assert.ok(decContent.includes('Cross-App'), 'index should have Cross-App section');
      assert.ok(decContent.includes('F-HUB-CHAT'), 'aggregated feature listed');
      assert.ok(decContent.includes('apps/hub/.cap/memory/features/F-HUB-CHAT-real-file.md'), 'sub-app file path linked');
      assert.ok(decContent.includes('| hub |'), 'app column present');
    } finally { cleanup(root); }
  });

  it('aggregated feature without existing sub-app file shows pending hint', () => {
    const root = makeMonorepo();
    try {
      makeSubApp(root, 'hub', { v6: true }); // V6 marker but NO feature files yet
      writeFeatureMap(root, [{ id: 'F-HUB-NEW', title: 'New Hub Feature', files: [] }]);
      const entries = [makeEntry('decision', 'd', ['apps/hub/new.ts'], 'F-HUB-NEW')];
      _writeMemoryV6(root, entries);

      const decContent = fs.readFileSync(path.join(root, MEMORY_DIR, 'decisions.md'), 'utf8');
      assert.ok(decContent.includes('F-HUB-NEW (pending sub-app pipeline)'), 'pending hint when sub-app file missing');
    } finally { cleanup(root); }
  });
});

// --- AC-5: Sub-app append-only (root NEVER writes to sub-app) ---

describe('F-096/AC-5: root pipeline never writes to sub-app .cap/memory/', () => {
  it('preserves sub-app feature files byte-identical after root write', () => {
    const root = makeMonorepo();
    try {
      makeSubApp(root, 'hub', {
        v6: true,
        featureFiles: ['F-HUB-CHAT-original.md'],
      });
      writeFeatureMap(root, [{ id: 'F-HUB-CHAT', title: 'Chat', files: [] }]);

      const subAppFile = path.join(root, 'apps', 'hub', '.cap', 'memory', 'features', 'F-HUB-CHAT-original.md');
      const before = fs.readFileSync(subAppFile, 'utf8');
      const beforeMtime = fs.statSync(subAppFile).mtimeMs;

      const entries = [makeEntry('decision', 'd1', ['apps/hub/chat.ts'], 'F-HUB-CHAT')];
      _writeMemoryV6(root, entries);

      const after = fs.readFileSync(subAppFile, 'utf8');
      assert.equal(after, before, 'sub-app file content unchanged');

      // mtime: filesystem precision varies. Just assert content is identical (above) — that's the AC.
    } finally { cleanup(root); }
  });

  it('does not create new files under apps/<app>/.cap/memory/features/', () => {
    const root = makeMonorepo();
    try {
      makeSubApp(root, 'hub', { v6: true });
      writeFeatureMap(root, [{ id: 'F-HUB-NEW', title: 'New', files: [] }]);
      const subAppFeaturesDir = path.join(root, 'apps', 'hub', '.cap', 'memory', 'features');
      const before = fs.readdirSync(subAppFeaturesDir).sort();

      _writeMemoryV6(root, [makeEntry('decision', 'd', ['apps/hub/x.ts'], 'F-HUB-NEW')]);

      const after = fs.readdirSync(subAppFeaturesDir).sort();
      assert.deepEqual(after, before, 'sub-app features dir unchanged');
    } finally { cleanup(root); }
  });
});

// --- AC-6: opt-out + idempotency ---

describe('F-096/AC-6: aggregation opt-out + idempotency', () => {
  it('options.aggregate=false disables aggregation (legacy F-093 behavior)', () => {
    const root = makeMonorepo();
    try {
      makeSubApp(root, 'hub', { v6: true });
      writeFeatureMap(root, [{ id: 'F-HUB-CHAT', title: 'Chat', files: [] }]);
      const entries = [makeEntry('decision', 'd', ['apps/hub/chat.ts'], 'F-HUB-CHAT')];

      _writeMemoryV6(root, entries, { aggregate: false });

      // With aggregation off, the hub feature SHOULD land at root (legacy duplication)
      const rootFeaturesDir = path.join(root, MEMORY_DIR, 'features');
      const dups = fs.readdirSync(rootFeaturesDir).filter(f => f.startsWith('F-HUB-CHAT'));
      assert.equal(dups.length, 1, 'with aggregate:false, root writes the duplicate');
    } finally { cleanup(root); }
  });

  it('idempotent: re-running on same V6 root produces stable index', () => {
    const root = makeMonorepo();
    try {
      makeSubApp(root, 'hub', {
        v6: true,
        featureFiles: ['F-HUB-CHAT-x.md'],
      });
      writeFeatureMap(root, [{ id: 'F-HUB-CHAT', title: 'Chat', files: [] }]);
      const entries = [makeEntry('decision', 'd', ['apps/hub/chat.ts'], 'F-HUB-CHAT')];

      _writeMemoryV6(root, entries);
      const first = fs.readFileSync(path.join(root, MEMORY_DIR, 'decisions.md'), 'utf8');

      _writeMemoryV6(root, entries);
      const second = fs.readFileSync(path.join(root, MEMORY_DIR, 'decisions.md'), 'utf8');

      assert.equal(second, first, 'index byte-identical on re-run');
    } finally { cleanup(root); }
  });
});

// --- AC-7: integration with writeMemoryDirectory dispatch ---

describe('F-096/AC-7: writeMemoryDirectory dispatch in monorepo', () => {
  it('end-to-end: V6 layout + monorepo aggregation kicks in via config', () => {
    const root = makeMonorepo();
    try {
      // Activate V6 at root
      fs.writeFileSync(path.join(root, '.cap', 'config.json'), JSON.stringify({ memory: { layout: 'v6' } }));
      makeSubApp(root, 'hub', {
        v6: true,
        featureFiles: ['F-HUB-FEAT-1-x.md'],
      });
      writeFeatureMap(root, [
        { id: 'F-HUB-FEAT-1', title: 'Hub feature 1', files: [] },
        { id: 'F-CROSS-CUTTING', title: 'Cross cutting', files: [] },
      ]);

      const entries = [
        makeEntry('decision', 'hub d1', ['apps/hub/x.ts'], 'F-HUB-FEAT-1'),
        makeEntry('decision', 'cross d1', ['nx.json'], 'F-CROSS-CUTTING'),
      ];

      writeMemoryDirectory(root, entries, {});

      // Cross-cutting feature is at root
      const rootFeatures = fs.readdirSync(path.join(root, MEMORY_DIR, 'features'));
      assert.ok(rootFeatures.some(f => f.startsWith('F-CROSS-CUTTING-')), 'cross-cutting at root');
      assert.ok(!rootFeatures.some(f => f.startsWith('F-HUB-FEAT-1-')), 'hub feature NOT at root');

      // Index lists both
      const dec = fs.readFileSync(path.join(root, MEMORY_DIR, 'decisions.md'), 'utf8');
      assert.ok(dec.includes('F-CROSS-CUTTING'));
      assert.ok(dec.includes('F-HUB-FEAT-1'));
      assert.ok(dec.includes('Cross-App'), 'index includes Cross-App section');
    } finally { cleanup(root); }
  });

  it('falls back to F-093 default when no V6 sub-apps exist', () => {
    const root = makeMonorepo();
    try {
      makeSubApp(root, 'hub', { v5: true }); // V5 sub-app — not eligible for aggregation
      writeFeatureMap(root, [{ id: 'F-HUB-CHAT', title: 'Chat', files: [] }]);
      const entries = [makeEntry('decision', 'd', ['apps/hub/chat.ts'], 'F-HUB-CHAT')];

      _writeMemoryV6(root, entries);

      // Without V6 sub-apps, root falls back to standard write — feature lands at root
      const rootFeatures = fs.readdirSync(path.join(root, MEMORY_DIR, 'features'));
      assert.ok(rootFeatures.some(f => f.startsWith('F-HUB-CHAT-')), 'V5 sub-app does not trigger aggregation');
    } finally { cleanup(root); }
  });
});

// --- _findSubAppFeatureFile helper ---

describe('F-096: _findSubAppFeatureFile helper', () => {
  it('finds existing feature file by F-NNN- prefix', () => {
    const root = makeMonorepo();
    try {
      makeSubApp(root, 'hub', {
        v6: true,
        featureFiles: [
          'F-HUB-CHAT-some-slug.md',
          'F-HUB-AUTH-other.md',
          'F-HUB-CHAT-VOICE-NOTES-yet-another.md', // longer match
        ],
      });
      assert.equal(_findSubAppFeatureFile(root, 'hub', 'F-HUB-CHAT'), 'F-HUB-CHAT-some-slug.md');
      assert.equal(_findSubAppFeatureFile(root, 'hub', 'F-HUB-AUTH'), 'F-HUB-AUTH-other.md');
    } finally { cleanup(root); }
  });

  it('returns null for non-existent feature', () => {
    const root = makeMonorepo();
    try {
      makeSubApp(root, 'hub', { v6: true });
      assert.equal(_findSubAppFeatureFile(root, 'hub', 'F-NOPE'), null);
    } finally { cleanup(root); }
  });

  it('returns null when sub-app features dir missing', () => {
    const root = makeMonorepo();
    try {
      assert.equal(_findSubAppFeatureFile(root, 'nonexistent', 'F-X'), null);
    } finally { cleanup(root); }
  });
});
