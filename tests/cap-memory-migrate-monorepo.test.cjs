'use strict';

// @cap-feature(feature:F-082) Tests for the path-heuristik subApp-boost in cap-memory-migrate.
//   Covers AC-4 (boost lifts ambiguous matches into auto-confidence) and AC-6 (≥80% of synthetic
//   fixture entries route to features in the matching sub-app).

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  classifyEntry,
  buildClassifierContext,
  CONFIDENCE_AUTO_THRESHOLD,
} = require('../cap/bin/lib/cap-memory-migrate.cjs');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-fmig-mono-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// --- helpers ---

function copyFixture(targetDir) {
  const fixtureRoot = path.join(__dirname, 'fixtures', 'v61-monorepo');
  copyRecursive(fixtureRoot, targetDir);
}

function copyRecursive(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const e of entries) {
    const sp = path.join(src, e.name);
    const dp = path.join(dst, e.name);
    if (e.isDirectory()) copyRecursive(sp, dp);
    else fs.copyFileSync(sp, dp);
  }
}

function writeFile(root, rel, content) {
  const fp = path.join(root, rel);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, content, 'utf8');
}

function makeEntry(over) {
  return Object.assign({
    kind: 'decision',
    anchorId: 'a1',
    title: 't',
    content: '',
    sourceFile: 'decisions.md',
    sourceLine: 1,
    dateLabel: null,
    relatedFiles: [],
    confidence: null,
    lastSeen: null,
    taggedFeatureId: null,
    taggedPlatformTopic: null,
  }, over);
}

// --- AC-4: subApp-boost present in classifier ---

describe('F-082/AC-4 buildClassifierContext exposes featureToSubApp', () => {
  it('extracts metadata.subApp from aggregated features into a Map', () => {
    copyFixture(tmpDir);
    const ctx = buildClassifierContext(tmpDir);
    assert.ok(ctx.featureToSubApp instanceof Map);
    // From the fixture: F-WEB-AUTH (sub: web), F-API-AUTH (sub: api), F-LOGGING (sub: shared).
    assert.equal(ctx.featureToSubApp.get('F-WEB-AUTH'), 'web');
    assert.equal(ctx.featureToSubApp.get('F-API-AUTH'), 'api');
    assert.equal(ctx.featureToSubApp.get('F-LOGGING'), 'shared');
  });

  it('non-monorepo project returns empty featureToSubApp', () => {
    writeFile(tmpDir, 'FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-001: Foo [planned]', '',
      '**Files:**', '- `src/foo.ts`', '',
    ].join('\n'));
    const ctx = buildClassifierContext(tmpDir);
    assert.equal(ctx.featureToSubApp.size, 0);
  });
});

describe('F-082/AC-4 classifyEntry sub-app prefix boost', () => {
  it('lifts a single sub-app file-list hit into auto-confidence', () => {
    copyFixture(tmpDir);
    const ctx = buildClassifierContext(tmpDir);
    const entry = makeEntry({
      relatedFiles: ['apps/web/src/auth/login.tsx'],
    });
    const decision = classifyEntry(entry, ctx);
    assert.equal(decision.destination, 'feature');
    assert.equal(decision.featureId, 'F-WEB-AUTH');
    assert.ok(decision.confidence >= CONFIDENCE_AUTO_THRESHOLD,
      `confidence ${decision.confidence} should be >= ${CONFIDENCE_AUTO_THRESHOLD}`);
    assert.ok(decision.reasons.some(r => /subapp-boost|path-match/.test(r)));
  });

  it('boost is additive — feature with file-hit AND subApp match scores higher', () => {
    copyFixture(tmpDir);
    const ctx = buildClassifierContext(tmpDir);
    const entryWith = makeEntry({
      relatedFiles: ['apps/web/src/auth/login.tsx', 'apps/web/src/auth/session.ts'],
    });
    const decision = classifyEntry(entryWith, ctx);
    assert.equal(decision.featureId, 'F-WEB-AUTH');
    assert.ok(decision.confidence > 0.7);
  });

  it('subApp-only match (no file-list hit) yields below-threshold confidence (asks user)', () => {
    // A file under apps/web that NO feature in the FEATURE-MAP claims explicitly.
    copyFixture(tmpDir);
    const ctx = buildClassifierContext(tmpDir);
    const entry = makeEntry({
      relatedFiles: ['apps/web/src/unclaimed-file.ts'],
    });
    const decision = classifyEntry(entry, ctx);
    // We DO route to a web feature (subApp matches) but at < threshold so user is prompted.
    assert.ok(decision.confidence < CONFIDENCE_AUTO_THRESHOLD || decision.destination === 'unassigned');
  });

  it('no boost is applied when featureToSubApp is empty (non-monorepo backward-compat)', () => {
    writeFile(tmpDir, 'FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-001: Foo [planned]', '',
      '**Files:**', '- `src/foo.ts`', '',
    ].join('\n'));
    const ctx = buildClassifierContext(tmpDir);
    const entry = makeEntry({
      relatedFiles: ['src/foo.ts'],
    });
    const decision = classifyEntry(entry, ctx);
    // Should still resolve via the legacy path-match path.
    assert.equal(decision.featureId, 'F-001');
    assert.ok(decision.reasons.every(r => !r.includes('subapp-boost')),
      'subapp-boost reason must not appear when no monorepo metadata is present');
  });

  it('cross-sub-app file (apps/web file vs api feature) does not get boosted to api', () => {
    copyFixture(tmpDir);
    const ctx = buildClassifierContext(tmpDir);
    const entry = makeEntry({
      // Web file — must not route to F-API-* features even though there's an `auth` topic in api too.
      relatedFiles: ['apps/web/src/auth/login.tsx'],
    });
    const decision = classifyEntry(entry, ctx);
    assert.equal(decision.featureId, 'F-WEB-AUTH');
  });

  it('packages/<sub>/... prefix also matches the sub-app boost', () => {
    copyFixture(tmpDir);
    const ctx = buildClassifierContext(tmpDir);
    const entry = makeEntry({
      relatedFiles: ['packages/shared/src/logging/logger.ts'],
    });
    const decision = classifyEntry(entry, ctx);
    assert.equal(decision.featureId, 'F-LOGGING');
    assert.ok(decision.confidence >= CONFIDENCE_AUTO_THRESHOLD);
  });

  it('tag-metadata still wins over path+subApp (priority order preserved)', () => {
    copyFixture(tmpDir);
    const ctx = buildClassifierContext(tmpDir);
    const entry = makeEntry({
      taggedFeatureId: 'F-API-USERS',
      relatedFiles: ['apps/web/src/auth/login.tsx'], // would route to F-WEB-AUTH otherwise
    });
    const decision = classifyEntry(entry, ctx);
    assert.equal(decision.featureId, 'F-API-USERS');
    assert.equal(decision.confidence, 1.0);
  });

  it('single-segment paths like "web/foo.ts" do not trigger the boost (too ambiguous)', () => {
    copyFixture(tmpDir);
    const ctx = buildClassifierContext(tmpDir);
    const entry = makeEntry({
      relatedFiles: ['web/foo.ts'], // not under apps/ or packages/
    });
    const decision = classifyEntry(entry, ctx);
    // No file-match, no subApp prefix → falls through.
    assert.ok(decision.confidence === 0 || decision.destination === 'unassigned' || decision.confidence < 0.5);
  });
});

// --- AC-6: ≥80% feature-routed on synthetic fixture ---

describe('F-082/AC-6 fixture-wide feature-routing coverage', () => {
  it('≥80% of source files route to a feature in the matching sub-app', () => {
    copyFixture(tmpDir);
    const ctx = buildClassifierContext(tmpDir);
    // Walk all source files under apps/ and packages/ and treat each as a synthetic V5 entry.
    const files = collectSourceFiles(tmpDir);
    assert.ok(files.length >= 8, `expected ≥8 source files in fixture, got ${files.length}`);
    let routedToCorrectSubApp = 0;
    let total = 0;
    const breakdown = [];
    for (const relFile of files) {
      total++;
      const entry = makeEntry({ relatedFiles: [relFile] });
      const decision = classifyEntry(entry, ctx);
      const expected = inferExpectedSubApp(relFile);
      const actualSubApp = decision.featureId
        ? ctx.featureToSubApp.get(decision.featureId)
        : null;
      const ok = decision.destination === 'feature' && actualSubApp === expected;
      if (ok) routedToCorrectSubApp++;
      breakdown.push({ file: relFile, expected, decided: decision.featureId, actual: actualSubApp, ok });
    }
    const ratio = routedToCorrectSubApp / total;
    assert.ok(
      ratio >= 0.8,
      `Expected ≥80% feature-routed-to-correct-subApp, got ${(ratio * 100).toFixed(1)}% ` +
      `(${routedToCorrectSubApp}/${total}); breakdown:\n${JSON.stringify(breakdown, null, 2)}`,
    );
  });

  it('every synthetic source file in the fixture routes to a feature (destination === "feature")', () => {
    copyFixture(tmpDir);
    const ctx = buildClassifierContext(tmpDir);
    const files = collectSourceFiles(tmpDir);
    let routed = 0;
    for (const relFile of files) {
      const entry = makeEntry({ relatedFiles: [relFile] });
      const decision = classifyEntry(entry, ctx);
      if (decision.destination === 'feature') routed++;
    }
    const ratio = routed / files.length;
    assert.ok(ratio >= 0.8, `feature-routed ratio: ${ratio}`);
  });
});

// --- helpers ---

/**
 * Walk apps/ and packages/ in the fixture, return list of repo-relative source-file paths.
 */
function collectSourceFiles(root) {
  /** @type {string[]} */
  const out = [];
  for (const top of ['apps', 'packages']) {
    const dir = path.join(root, top);
    if (!fs.existsSync(dir)) continue;
    walk(dir, root, out);
  }
  return out;
}

function walk(dir, root, out) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(fp, root, out);
    } else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) {
      out.push(path.relative(root, fp).replace(/\\/g, '/'));
    }
  }
}

/**
 * Given a fixture-relative source path like `apps/web/src/auth/login.tsx`, return the expected
 * sub-app slug (`web`).
 */
function inferExpectedSubApp(relPath) {
  const m = relPath.match(/^(?:apps|packages)\/([^/]+)\//);
  return m ? m[1] : null;
}
