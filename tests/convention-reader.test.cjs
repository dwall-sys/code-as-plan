'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { readProjectConventions, discoverDirectories, detectNamingConvention } = require('../cap/bin/lib/convention-reader.cjs');

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

  it('returns unknown when no directories match any pattern', () => {
    // Single-word lowercase names don't match kebab, camel, pascal, or snake
    assert.strictEqual(detectNamingConvention(['src', 'lib', 'bin']), 'unknown');
  });
});

// ─── additional readProjectConventions branches ─────────────────────────────

describe('readProjectConventions additional branches', () => {
  it('reads jsconfig.json when tsconfig.json does not exist', () => {
    fs.writeFileSync(path.join(tmpDir, 'jsconfig.json'), JSON.stringify({
      compilerOptions: { paths: { '~/*': ['src/*'] } }
    }));
    const report = readProjectConventions(tmpDir);
    assert.deepStrictEqual(report.pathAliases, { '~/*': ['src/*'] });
  });

  it('handles malformed tsconfig.json gracefully', () => {
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), 'not valid json at all');
    const report = readProjectConventions(tmpDir);
    assert.deepStrictEqual(report.pathAliases, {});
  });

  it('detects mocha as test runner', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      devDependencies: { mocha: '^10.0.0' }
    }));
    const report = readProjectConventions(tmpDir);
    assert.strictEqual(report.testRunner, 'mocha');
  });

  it('detects ava as test runner', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      devDependencies: { ava: '^5.0.0' }
    }));
    const report = readProjectConventions(tmpDir);
    assert.strictEqual(report.testRunner, 'ava');
  });

  it('detects vite as build tool', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      devDependencies: { vite: '^5.0.0' }
    }));
    const report = readProjectConventions(tmpDir);
    assert.strictEqual(report.buildTool, 'vite');
  });

  it('detects webpack as build tool', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      devDependencies: { webpack: '^5.0.0' }
    }));
    const report = readProjectConventions(tmpDir);
    assert.strictEqual(report.buildTool, 'webpack');
  });

  it('detects rollup as build tool', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      devDependencies: { rollup: '^4.0.0' }
    }));
    const report = readProjectConventions(tmpDir);
    assert.strictEqual(report.buildTool, 'rollup');
  });

  it('detects __tests__/ as separate test directory', () => {
    fs.mkdirSync(path.join(tmpDir, '__tests__'));
    const report = readProjectConventions(tmpDir);
    assert.strictEqual(report.testPattern, 'separate-dir');
  });

  it('detects nested tests/ directory as separate-dir', () => {
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'src', 'tests'), { recursive: true });
    const report = readProjectConventions(tmpDir);
    assert.strictEqual(report.testPattern, 'separate-dir');
  });

  it('detects .eslintrc.js as eslint', () => {
    fs.writeFileSync(path.join(tmpDir, '.eslintrc.js'), 'module.exports = {};');
    const report = readProjectConventions(tmpDir);
    assert.strictEqual(report.linter, 'eslint');
  });

  it('detects biome.jsonc as biome', () => {
    fs.writeFileSync(path.join(tmpDir, 'biome.jsonc'), '{}');
    const report = readProjectConventions(tmpDir);
    assert.strictEqual(report.linter, 'biome');
  });

  it('handles package.json without devDependencies', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test' }));
    const report = readProjectConventions(tmpDir);
    assert.strictEqual(report.testRunner, null);
    assert.strictEqual(report.buildTool, null);
  });
});

// ─── discoverDirectories edge cases ─────────────────────────────────────────

describe('discoverDirectories edge cases', () => {
  it('skips .planning directory', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning'));
    fs.mkdirSync(path.join(tmpDir, 'src'));
    const dirs = discoverDirectories(tmpDir, 1);
    assert.ok(!dirs.includes('.planning'));
    assert.ok(dirs.includes('src'));
  });

  it('handles permission errors gracefully', () => {
    // Passing a file instead of a directory — readdirSync will fail
    const filePath = path.join(tmpDir, 'afile.txt');
    fs.writeFileSync(filePath, 'content');
    const dirs = discoverDirectories(filePath, 1);
    assert.deepStrictEqual(dirs, []);
  });
});
