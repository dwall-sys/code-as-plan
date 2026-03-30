'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { readProjectConventions, discoverDirectories, detectNamingConvention } = require('../get-shit-done/bin/lib/convention-reader.cjs');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'conv-reader-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('readProjectConventions', () => {
  it('returns unknown defaults for empty directory', () => {
    const report = readProjectConventions(tmpDir);
    assert.strictEqual(report.moduleType, 'unknown');
    assert.strictEqual(report.namingConvention, 'unknown');
    assert.strictEqual(report.testPattern, 'unknown');
    assert.strictEqual(report.testRunner, null);
    assert.strictEqual(report.buildTool, null);
    assert.strictEqual(report.linter, null);
    assert.deepStrictEqual(report.pathAliases, {});
    assert.strictEqual(report.packageJson, null);
  });

  it('detects ESM module type from package.json', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ type: 'module' }));
    const report = readProjectConventions(tmpDir);
    assert.strictEqual(report.moduleType, 'esm');
  });

  it('detects CJS module type from package.json without type field', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test' }));
    const report = readProjectConventions(tmpDir);
    assert.strictEqual(report.moduleType, 'cjs');
  });

  it('detects vitest as test runner', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      devDependencies: { vitest: '^1.0.0' }
    }));
    const report = readProjectConventions(tmpDir);
    assert.strictEqual(report.testRunner, 'vitest');
  });

  it('detects jest as test runner', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      devDependencies: { jest: '^29.0.0' }
    }));
    const report = readProjectConventions(tmpDir);
    assert.strictEqual(report.testRunner, 'jest');
  });

  it('detects esbuild as build tool', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      devDependencies: { esbuild: '^0.27.0' }
    }));
    const report = readProjectConventions(tmpDir);
    assert.strictEqual(report.buildTool, 'esbuild');
  });

  it('detects separate test directory', () => {
    fs.mkdirSync(path.join(tmpDir, 'tests'));
    const report = readProjectConventions(tmpDir);
    assert.strictEqual(report.testPattern, 'separate-dir');
  });

  it('detects eslint from config file', () => {
    fs.writeFileSync(path.join(tmpDir, '.eslintrc.json'), '{}');
    const report = readProjectConventions(tmpDir);
    assert.strictEqual(report.linter, 'eslint');
  });

  it('detects biome from config file', () => {
    fs.writeFileSync(path.join(tmpDir, 'biome.json'), '{}');
    const report = readProjectConventions(tmpDir);
    assert.strictEqual(report.linter, 'biome');
  });

  it('reads tsconfig path aliases', () => {
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { paths: { '@/*': ['src/*'] } }
    }));
    const report = readProjectConventions(tmpDir);
    assert.deepStrictEqual(report.pathAliases, { '@/*': ['src/*'] });
  });

  it('reads tsconfig with JSONC comments', () => {
    const jsonc = `{
      // This is a comment
      "compilerOptions": {
        /* block comment */
        "paths": { "@/*": ["src/*"] }
      }
    }`;
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), jsonc);
    const report = readProjectConventions(tmpDir);
    assert.deepStrictEqual(report.pathAliases, { '@/*': ['src/*'] });
  });

  it('handles malformed package.json gracefully', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), 'not valid json');
    const report = readProjectConventions(tmpDir);
    assert.strictEqual(report.packageJson, null);
    assert.strictEqual(report.moduleType, 'unknown');
  });
});

describe('discoverDirectories', () => {
  it('returns empty array for empty directory', () => {
    const dirs = discoverDirectories(tmpDir, 3);
    assert.deepStrictEqual(dirs, []);
  });

  it('finds top-level directories', () => {
    fs.mkdirSync(path.join(tmpDir, 'src'));
    fs.mkdirSync(path.join(tmpDir, 'lib'));
    const dirs = discoverDirectories(tmpDir, 1);
    assert.ok(dirs.includes('src'));
    assert.ok(dirs.includes('lib'));
  });

  it('skips node_modules and .git', () => {
    fs.mkdirSync(path.join(tmpDir, 'node_modules'));
    fs.mkdirSync(path.join(tmpDir, '.git'));
    fs.mkdirSync(path.join(tmpDir, 'src'));
    const dirs = discoverDirectories(tmpDir, 1);
    assert.ok(!dirs.includes('node_modules'));
    assert.ok(!dirs.includes('.git'));
    assert.ok(dirs.includes('src'));
  });

  it('respects maxDepth', () => {
    fs.mkdirSync(path.join(tmpDir, 'a', 'b', 'c'), { recursive: true });
    const depth1 = discoverDirectories(tmpDir, 1);
    assert.ok(depth1.includes('a'));
    assert.ok(!depth1.some(d => d.includes('b')));
  });
});

describe('detectNamingConvention', () => {
  it('detects kebab-case', () => {
    assert.strictEqual(detectNamingConvention(['my-component', 'auth-service', 'data-layer']), 'kebab-case');
  });

  it('detects camelCase', () => {
    assert.strictEqual(detectNamingConvention(['myComponent', 'authService', 'dataLayer']), 'camelCase');
  });

  it('detects PascalCase', () => {
    assert.strictEqual(detectNamingConvention(['MyComponent', 'AuthService', 'DataLayer']), 'PascalCase');
  });

  it('detects snake_case', () => {
    assert.strictEqual(detectNamingConvention(['my_component', 'auth_service', 'data_layer']), 'snake_case');
  });

  it('returns unknown for empty input', () => {
    assert.strictEqual(detectNamingConvention([]), 'unknown');
  });

  it('returns unknown for single-char names', () => {
    assert.strictEqual(detectNamingConvention(['a', 'b', 'c']), 'unknown');
  });
});
