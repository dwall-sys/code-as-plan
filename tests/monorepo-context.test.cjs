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
  loadGlobalContextRefs,
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

  it('returns empty when manifestsDir does not exist', () => {
    const root = makeTmpDir();
    const appDir = path.join(root, 'apps', 'web');
    fs.mkdirSync(appDir, { recursive: true });

    const result = resolveRelevantManifests(path.join(root, 'nonexistent'), appDir, []);
    assert.deepStrictEqual(result, []);
  });

  it('uses knownDeps when package.json is missing', () => {
    const root = makeTmpDir();
    const manifestsDir = path.join(root, '.planning', 'manifests');
    fs.mkdirSync(manifestsDir, { recursive: true });
    fs.writeFileSync(path.join(manifestsDir, 'shared-utils.md'), '# shared-utils\n', 'utf-8');

    const appDir = path.join(root, 'apps', 'web');
    fs.mkdirSync(appDir, { recursive: true });
    // No package.json in appDir

    const result = resolveRelevantManifests(manifestsDir, appDir, ['shared-utils']);
    assert.strictEqual(result.length, 1);
    assert.ok(result[0].endsWith('shared-utils.md'));
  });

  it('handles unreadable manifestsDir gracefully', () => {
    const root = makeTmpDir();
    // Create a file (not directory) at manifests path to cause readdirSync to throw
    const manifestsDir = path.join(root, '.planning', 'manifests');
    fs.mkdirSync(path.dirname(manifestsDir), { recursive: true });
    fs.writeFileSync(manifestsDir, 'not a directory', 'utf-8');

    const appDir = path.join(root, 'apps', 'web');
    fs.mkdirSync(appDir, { recursive: true });
    writeJson(path.join(appDir, 'package.json'), {
      dependencies: { '@acme/ui': 'workspace:*' },
    });

    const result = resolveRelevantManifests(manifestsDir, appDir, []);
    assert.deepStrictEqual(result, []);
  });

  it('also picks up devDependencies with workspace: protocol', () => {
    const root = makeTmpDir();
    const manifestsDir = path.join(root, '.planning', 'manifests');
    fs.mkdirSync(manifestsDir, { recursive: true });
    fs.writeFileSync(path.join(manifestsDir, 'test-utils.md'), '# test-utils\n', 'utf-8');

    const appDir = path.join(root, 'apps', 'web');
    fs.mkdirSync(appDir, { recursive: true });
    writeJson(path.join(appDir, 'package.json'), {
      devDependencies: { 'test-utils': 'workspace:^' },
    });

    const result = resolveRelevantManifests(manifestsDir, appDir, []);
    assert.strictEqual(result.length, 1);
  });
});

// ── loadGlobalContextRefs ─────────────────────────────────────────────────

describe('loadGlobalContextRefs', () => {
  it('detects PROJECT.md and extracts summary', () => {
    const root = makeTmpDir();
    const planDir = path.join(root, '.planning');
    fs.mkdirSync(planDir, { recursive: true });
    fs.writeFileSync(path.join(planDir, 'PROJECT.md'), '# My Project\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\n', 'utf-8');

    const refs = loadGlobalContextRefs(planDir);
    assert.strictEqual(refs.hasProject, true);
    assert.ok(refs.projectSummary.includes('# My Project'));
    assert.ok(refs.projectSummary.includes('Line 5'));
    // Line 6 should NOT be included (only first 5 lines)
    assert.ok(!refs.projectSummary.includes('Line 6'));
  });

  it('detects ROADMAP.md and REQUIREMENTS.md', () => {
    const root = makeTmpDir();
    const planDir = path.join(root, '.planning');
    fs.mkdirSync(planDir, { recursive: true });
    fs.writeFileSync(path.join(planDir, 'ROADMAP.md'), '# Roadmap\n', 'utf-8');
    fs.writeFileSync(path.join(planDir, 'REQUIREMENTS.md'), '# Reqs\n', 'utf-8');

    const refs = loadGlobalContextRefs(planDir);
    assert.strictEqual(refs.hasRoadmap, true);
    assert.strictEqual(refs.hasRequirements, true);
  });

  it('returns false flags when files are missing', () => {
    const root = makeTmpDir();
    const planDir = path.join(root, '.planning');
    fs.mkdirSync(planDir, { recursive: true });

    const refs = loadGlobalContextRefs(planDir);
    assert.strictEqual(refs.hasProject, false);
    assert.strictEqual(refs.hasRoadmap, false);
    assert.strictEqual(refs.hasRequirements, false);
    assert.strictEqual(refs.projectSummary, null);
  });

  it('handles PROJECT.md that is a directory (unreadable as file)', () => {
    const root = makeTmpDir();
    const planDir = path.join(root, '.planning');
    // Create PROJECT.md as a directory so readFileSync throws
    fs.mkdirSync(path.join(planDir, 'PROJECT.md'), { recursive: true });

    const refs = loadGlobalContextRefs(planDir);
    assert.strictEqual(refs.hasProject, true);
    // projectSummary should be null because readFileSync throws on a directory
    assert.strictEqual(refs.projectSummary, null);
  });
});
