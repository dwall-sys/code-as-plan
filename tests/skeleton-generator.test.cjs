'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { generateSkeletonPlan, applyNamingConvention, buildTreeString } = require('../cap/bin/lib/skeleton-generator.cjs');

const defaultConventions = {
  moduleType: 'cjs',
  namingConvention: 'kebab-case',
  testPattern: 'separate-dir',
  testRunner: 'vitest',
  pathAliases: {},
  buildTool: null,
  linter: null,
  existingDirs: [],
  packageJson: null,
};

describe('generateSkeletonPlan', () => {
  it('generates plan with correct file counts for single module', () => {
    const plan = generateSkeletonPlan(defaultConventions, ['auth']);
    assert.ok(plan.files.length > 0);
    assert.ok(plan.tree.length > 0);
    assert.strictEqual(typeof plan.dirCount, 'number');
    assert.strictEqual(typeof plan.configCount, 'number');
    assert.strictEqual(typeof plan.interfaceCount, 'number');
    assert.strictEqual(typeof plan.boundaryCount, 'number');
  });

  it('creates 3 files per module (barrel, types, stub)', () => {
    const plan = generateSkeletonPlan(defaultConventions, ['users']);
    const userFiles = plan.files.filter(f => f.relativePath.includes('users'));
    assert.strictEqual(userFiles.length, 3);
    assert.ok(userFiles.some(f => f.type === 'barrel'));
    assert.ok(userFiles.some(f => f.type === 'interface'));
    assert.ok(userFiles.some(f => f.type === 'stub'));
  });

  it('scales with multiple modules', () => {
    const plan = generateSkeletonPlan(defaultConventions, ['auth', 'users', 'tasks']);
    const moduleFiles = plan.files.filter(f => f.type === 'barrel' || f.type === 'interface' || f.type === 'stub');
    // 3 files per module = 9, plus shared types interface
    assert.ok(moduleFiles.length >= 9);
    assert.strictEqual(plan.boundaryCount, 3);
  });

  it('includes package.json and entry point', () => {
    const plan = generateSkeletonPlan(defaultConventions, ['auth']);
    assert.ok(plan.files.some(f => f.relativePath === 'package.json'));
    assert.ok(plan.files.some(f => f.type === 'entry'));
  });

  it('uses .cjs extension for CJS projects', () => {
    const plan = generateSkeletonPlan({ ...defaultConventions, moduleType: 'cjs' }, ['auth']);
    const entry = plan.files.find(f => f.type === 'entry');
    assert.ok(entry.relativePath.endsWith('.cjs'));
  });

  it('uses .js extension for ESM projects', () => {
    const plan = generateSkeletonPlan({ ...defaultConventions, moduleType: 'esm' }, ['auth']);
    const entry = plan.files.find(f => f.type === 'entry');
    assert.ok(entry.relativePath.endsWith('.js'));
  });

  it('includes tsconfig when path aliases exist', () => {
    const conv = { ...defaultConventions, pathAliases: { '@/*': ['src/*'] } };
    const plan = generateSkeletonPlan(conv, ['auth']);
    assert.ok(plan.files.some(f => f.relativePath === 'tsconfig.json'));
  });

  it('skips tsconfig when no path aliases', () => {
    const plan = generateSkeletonPlan(defaultConventions, ['auth']);
    assert.ok(!plan.files.some(f => f.relativePath === 'tsconfig.json'));
  });

  it('includes test directory for separate-dir pattern', () => {
    const plan = generateSkeletonPlan({ ...defaultConventions, testPattern: 'separate-dir' }, ['auth']);
    assert.ok(plan.files.some(f => f.relativePath.startsWith('tests/')));
  });

  it('returns valid tree string', () => {
    const plan = generateSkeletonPlan(defaultConventions, ['auth']);
    assert.ok(plan.tree.startsWith('project-root/'));
    assert.ok(plan.tree.includes('auth'));
  });
});

describe('applyNamingConvention', () => {
  it('converts to kebab-case', () => {
    assert.strictEqual(applyNamingConvention('user auth', 'kebab-case'), 'user-auth');
  });

  it('converts to camelCase', () => {
    assert.strictEqual(applyNamingConvention('user auth', 'camelCase'), 'userAuth');
  });

  it('converts to PascalCase', () => {
    assert.strictEqual(applyNamingConvention('user auth', 'PascalCase'), 'UserAuth');
  });

  it('converts to snake_case', () => {
    assert.strictEqual(applyNamingConvention('user auth', 'snake_case'), 'user_auth');
  });

  it('defaults to kebab-case for unknown convention', () => {
    assert.strictEqual(applyNamingConvention('user auth', 'unknown'), 'user-auth');
  });
});

describe('buildTreeString', () => {
  it('produces formatted tree with indentation', () => {
    const files = [
      { relativePath: 'package.json', type: 'config', purpose: 'manifest' },
      { relativePath: 'src/index.js', type: 'entry', purpose: 'entry' },
    ];
    const tree = buildTreeString(files);
    assert.ok(tree.includes('project-root/'));
    assert.ok(tree.includes('package.json'));
    assert.ok(tree.includes('index.js'));
  });
});
