/**
 * Tests for monorepo-context.cjs
 *
 * Unit tests for monorepo context resolver module.
 * Follows node:test pattern established by existing test files.
 */

'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  resolveAppPlanningDir,
  initAppPlanning,
  buildMonorepoContext,
  resolveRelevantManifests,
  scopeExtractTags,
} = require('../cap/bin/lib/monorepo-context.cjs');

// ── Helpers ────────────────────────────────────────────────────────────────

let tmpDirs = [];

function makeTmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-ctx-test-'));
  tmpDirs.push(dir);
  return dir;
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

afterEach(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs = [];
});

// ── resolveAppPlanningDir ──────────────────────────────────────────────────

describe('resolveAppPlanningDir', () => {
  it('returns [root]/[app]/.planning', () => {
    const result = resolveAppPlanningDir('/project', 'apps/dashboard');
    assert.strictEqual(result, path.join('/project', 'apps/dashboard', '.planning'));
  });
});

// ── initAppPlanning ────────────────────────────────────────────────────────

describe('initAppPlanning', () => {
  it('creates all expected files', () => {
    const root = makeTmpDir();
    const appDir = path.join(root, 'apps', 'web');
    fs.mkdirSync(appDir, { recursive: true });

    const planningDir = initAppPlanning(root, 'apps/web', { appName: 'WebApp' });

    assert.ok(fs.existsSync(planningDir));
    assert.ok(fs.existsSync(path.join(planningDir, 'PRD.md')));
    assert.ok(fs.existsSync(path.join(planningDir, 'FEATURES.md')));
    assert.ok(fs.existsSync(path.join(planningDir, 'prototype', 'CODE-INVENTORY.md')));
  });

  it('does not overwrite existing PRD.md', () => {
    const root = makeTmpDir();
    const appDir = path.join(root, 'apps', 'web');
    const planningDir = path.join(appDir, '.planning');
    fs.mkdirSync(planningDir, { recursive: true });
    fs.writeFileSync(path.join(planningDir, 'PRD.md'), 'Custom PRD content', 'utf-8');

    initAppPlanning(root, 'apps/web');

    const content = fs.readFileSync(path.join(planningDir, 'PRD.md'), 'utf-8');
    assert.strictEqual(content, 'Custom PRD content');
  });

  it('creates prototype/CODE-INVENTORY.md stub', () => {
    const root = makeTmpDir();
    fs.mkdirSync(path.join(root, 'apps', 'web'), { recursive: true });

    initAppPlanning(root, 'apps/web');

    const inventoryPath = path.join(root, 'apps', 'web', '.planning', 'prototype', 'CODE-INVENTORY.md');
    assert.ok(fs.existsSync(inventoryPath));
    const content = fs.readFileSync(inventoryPath, 'utf-8');
    assert.ok(content.includes('CODE-INVENTORY.md'));
    assert.ok(content.includes('extract-plan'));
  });
});

// ── buildMonorepoContext ───────────────────────────────────────────────────

describe('buildMonorepoContext', () => {
  it('returns all six MonorepoContext fields', () => {
    const root = makeTmpDir();
    fs.mkdirSync(path.join(root, 'apps', 'web'), { recursive: true });
    fs.mkdirSync(path.join(root, '.planning'), { recursive: true });

    const ctx = buildMonorepoContext(root, 'apps/web', { appName: 'WebApp' });

    assert.ok(ctx.rootPlanningDir, 'rootPlanningDir should exist');
    assert.ok(ctx.appPlanningDir, 'appPlanningDir should exist');
    assert.ok(ctx.appRoot, 'appRoot should exist');
    assert.strictEqual(ctx.appName, 'WebApp');
    assert.ok(Array.isArray(ctx.manifestPaths), 'manifestPaths should be an array');
    assert.ok(ctx.globalContext !== undefined, 'globalContext should exist');
  });
});

// ── scopeExtractTags ───────────────────────────────────────────────────────

describe('scopeExtractTags', () => {
  it('overrides targetPath to app absolute path', () => {
    const result = scopeExtractTags('/project', 'apps/dashboard', {
      format: 'json',
      outputFile: 'CODE-INVENTORY.md',
    });
    assert.strictEqual(result.targetPath, path.join('/project', 'apps/dashboard'));
  });

  it('preserves outputFile: null when original is null', () => {
    const result = scopeExtractTags('/project', 'apps/dashboard', {
      format: 'json',
      outputFile: null,
    });
    assert.strictEqual(result.outputFile, null);
  });
});

// ── resolveRelevantManifests ───────────────────────────────────────────────

describe('resolveRelevantManifests', () => {
  it('matches @acme/ui dep to acme__ui.md manifest file', () => {
    const root = makeTmpDir();
    const manifestsDir = path.join(root, '.planning', 'manifests');
    fs.mkdirSync(manifestsDir, { recursive: true });
    fs.writeFileSync(path.join(manifestsDir, 'acme__ui.md'), '# @acme/ui\n', 'utf-8');

    const appDir = path.join(root, 'apps', 'web');
    fs.mkdirSync(appDir, { recursive: true });
    writeJson(path.join(appDir, 'package.json'), {
      dependencies: { '@acme/ui': 'workspace:*' },
    });

    const result = resolveRelevantManifests(manifestsDir, appDir, []);
    assert.strictEqual(result.length, 1);
    assert.ok(result[0].endsWith('acme__ui.md'));
  });
});
