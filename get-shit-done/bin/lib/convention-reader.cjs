// @gsd-context(phase:11) Convention reader utility -- discovers existing project conventions for architecture mode
// @gsd-decision Implemented as a standalone CJS module (not inline in the agent) so it can be tested independently
// @gsd-ref(ref:ARCH-03) gsd-prototyper reads existing project conventions before generating skeleton
// @gsd-constraint Zero external dependencies -- uses only Node.js built-ins (fs, path)

'use strict';

const fs = require('node:fs');
const path = require('node:path');

// @gsd-api readProjectConventions(projectRoot) -- returns ConventionReport object describing discovered patterns
// @gsd-pattern Convention reader returns a structured report that the agent prompt can serialize into context

/**
 * @typedef {Object} ConventionReport
 * @property {string} moduleType - 'esm' | 'cjs' | 'unknown'
 * @property {string} namingConvention - 'kebab-case' | 'camelCase' | 'PascalCase' | 'snake_case' | 'unknown'
 * @property {string} testPattern - 'colocated' | 'separate-dir' | 'unknown'
 * @property {string|null} testRunner - detected test runner name or null
 * @property {Object} pathAliases - e.g., { '@/*': ['src/*'] }
 * @property {string|null} buildTool - detected build tool or null
 * @property {string|null} linter - detected linter or null
 * @property {string[]} existingDirs - list of existing directories (max depth 3)
 * @property {Object} packageJson - parsed package.json or null
 */

/**
 * Reads existing project conventions from config files and directory structure.
 * Used by gsd-prototyper in architecture mode to match generated skeleton
 * to the project's established patterns.
 *
 * @param {string} projectRoot - absolute path to project root
 * @returns {ConventionReport}
 */
function readProjectConventions(projectRoot) {
  // @gsd-todo(ref:AC-3) Implement full convention discovery: package.json parsing, tsconfig reading, directory pattern detection, linter config extraction
  const report = {
    moduleType: 'unknown',
    namingConvention: 'unknown',
    testPattern: 'unknown',
    testRunner: null,
    pathAliases: {},
    buildTool: null,
    linter: null,
    existingDirs: [],
    packageJson: null,
  };

  // --- package.json detection ---
  // @gsd-context Reads package.json for module type, naming conventions, and dependency-based framework detection
  const pkgPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      report.packageJson = pkg;
      report.moduleType = pkg.type === 'module' ? 'esm' : 'cjs';

      // @gsd-decision Detect test runner from devDependencies keys rather than config files -- faster and covers most cases
      if (pkg.devDependencies) {
        if (pkg.devDependencies.vitest) report.testRunner = 'vitest';
        else if (pkg.devDependencies.jest) report.testRunner = 'jest';
        else if (pkg.devDependencies.mocha) report.testRunner = 'mocha';
        else if (pkg.devDependencies.ava) report.testRunner = 'ava';
      }

      // @gsd-decision Detect build tool from devDependencies -- covers esbuild, webpack, vite, rollup
      if (pkg.devDependencies) {
        if (pkg.devDependencies.esbuild) report.buildTool = 'esbuild';
        else if (pkg.devDependencies.vite) report.buildTool = 'vite';
        else if (pkg.devDependencies.webpack) report.buildTool = 'webpack';
        else if (pkg.devDependencies.rollup) report.buildTool = 'rollup';
      }
    } catch (_e) {
      // @gsd-risk Malformed package.json silently ignored -- could produce incorrect convention report
    }
  }

  // --- tsconfig.json / jsconfig.json detection ---
  // @gsd-context Reads TypeScript/JavaScript config for path aliases and module resolution
  const tsconfigPath = path.join(projectRoot, 'tsconfig.json');
  const jsconfigPath = path.join(projectRoot, 'jsconfig.json');
  const configPath = fs.existsSync(tsconfigPath) ? tsconfigPath : (fs.existsSync(jsconfigPath) ? jsconfigPath : null);

  if (configPath) {
    try {
      // @gsd-risk tsconfig.json may have comments (JSONC) -- JSON.parse will fail on comments. Stub ignores this for now.
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (config.compilerOptions && config.compilerOptions.paths) {
        report.pathAliases = config.compilerOptions.paths;
      }
    } catch (_e) {
      // JSONC not handled in stub
    }
  }

  // --- Directory structure detection ---
  // @gsd-context Reads directory names to detect naming convention (kebab-case vs camelCase etc.)
  report.existingDirs = discoverDirectories(projectRoot, 3);
  report.namingConvention = detectNamingConvention(report.existingDirs);

  // --- Test pattern detection ---
  // @gsd-decision Check for tests/ or __tests__/ directory first, then fall back to checking for colocated .test. files
  const hasTestsDir = report.existingDirs.some(d => d.endsWith('/tests') || d.endsWith('/__tests__'));
  if (hasTestsDir) {
    report.testPattern = 'separate-dir';
  }
  // @gsd-todo Detect colocated test pattern by scanning for *.test.* files alongside source files

  // --- Linter detection ---
  // @gsd-context Checks for linter config files to match code style in generated skeleton
  const linterFiles = ['.eslintrc', '.eslintrc.js', '.eslintrc.json', '.eslintrc.cjs', 'biome.json', 'biome.jsonc'];
  for (const f of linterFiles) {
    if (fs.existsSync(path.join(projectRoot, f))) {
      report.linter = f.includes('biome') ? 'biome' : 'eslint';
      break;
    }
  }

  return report;
}

/**
 * Recursively discovers directories up to maxDepth.
 * @param {string} dir
 * @param {number} maxDepth
 * @param {number} [currentDepth=0]
 * @returns {string[]}
 */
function discoverDirectories(dir, maxDepth, currentDepth = 0) {
  // @gsd-constraint Uses readdirSync (not glob) per project zero-dep constraint
  if (currentDepth >= maxDepth) return [];

  const results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.planning') continue;

      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(dir, fullPath);
      results.push(relativePath);
      const children = discoverDirectories(fullPath, maxDepth, currentDepth + 1);
      results.push(...children.map(c => path.join(entry.name, c)));
    }
  } catch (_e) {
    // Permission errors etc.
  }

  return results;
}

/**
 * Detects naming convention from directory names.
 * @param {string[]} dirs
 * @returns {string}
 */
function detectNamingConvention(dirs) {
  // @gsd-decision Simple heuristic: check if majority of directory names match a pattern
  // @gsd-risk Heuristic may misclassify projects with mixed naming -- returns 'unknown' when ambiguous
  const leafNames = dirs.map(d => path.basename(d)).filter(n => n.length > 1);
  if (leafNames.length === 0) return 'unknown';

  const kebab = leafNames.filter(n => /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(n)).length;
  const camel = leafNames.filter(n => /^[a-z][a-zA-Z0-9]+$/.test(n) && /[A-Z]/.test(n)).length;
  const pascal = leafNames.filter(n => /^[A-Z][a-zA-Z0-9]+$/.test(n)).length;
  const snake = leafNames.filter(n => /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(n)).length;

  const max = Math.max(kebab, camel, pascal, snake);
  if (max === 0) return 'unknown';
  if (kebab === max) return 'kebab-case';
  if (camel === max) return 'camelCase';
  if (pascal === max) return 'PascalCase';
  if (snake === max) return 'snake_case';
  return 'unknown';
}

module.exports = { readProjectConventions, discoverDirectories, detectNamingConvention };
