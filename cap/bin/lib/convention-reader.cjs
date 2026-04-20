// @cap-context(phase:11) Convention reader utility -- discovers existing project conventions for architecture mode
// @cap-decision Implemented as a standalone CJS module (not inline in the agent) so it can be tested independently
// @cap-ref(ref:ARCH-03) gsd-prototyper reads existing project conventions before generating skeleton
// @cap-constraint Zero external dependencies -- uses only Node.js built-ins (fs, path)

'use strict';

// @cap-feature(feature:F-013) Convention & Skeleton Generation — project convention discovery
// @cap-feature(feature:F-044) Audit and Right-Size Agent Behaviors for Opus 4.7 — minimal two-anchor probe
// @cap-decision(F-044/AC-3) Two-anchor probe replaces 6-7 file reads. CLAUDE.md + package.json are the
//   highest-signal inputs for project context. Everything else (eslint config, tsconfig, naming
//   convention, test pattern, build tool) can be inferred by Opus 4.7 from those two anchors plus a
//   small handful of sample source files chosen on demand. The legacy readProjectConventions() is
//   preserved for backwards compatibility -- see probeProjectAnchors() below for the right-sized API.

const fs = require('node:fs');
const path = require('node:path');

// @cap-api readProjectConventions(projectRoot) -- returns ConventionReport object describing discovered patterns
// @cap-pattern Convention reader returns a structured report that the agent prompt can serialize into context

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
  // @cap-todo(ref:AC-3) Implement full convention discovery: package.json parsing, tsconfig reading, directory pattern detection, linter config extraction
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
  // @cap-context Reads package.json for module type, naming conventions, and dependency-based framework detection
  const pkgPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      report.packageJson = pkg;
      report.moduleType = pkg.type === 'module' ? 'esm' : 'cjs';

      // @cap-decision Detect test runner from devDependencies keys rather than config files -- faster and covers most cases
      if (pkg.devDependencies) {
        if (pkg.devDependencies.vitest) report.testRunner = 'vitest';
        else if (pkg.devDependencies.jest) report.testRunner = 'jest';
        else if (pkg.devDependencies.mocha) report.testRunner = 'mocha';
        else if (pkg.devDependencies.ava) report.testRunner = 'ava';
      }

      // @cap-decision Detect build tool from devDependencies -- covers esbuild, webpack, vite, rollup
      if (pkg.devDependencies) {
        if (pkg.devDependencies.esbuild) report.buildTool = 'esbuild';
        else if (pkg.devDependencies.vite) report.buildTool = 'vite';
        else if (pkg.devDependencies.webpack) report.buildTool = 'webpack';
        else if (pkg.devDependencies.rollup) report.buildTool = 'rollup';
      }
    } catch (_e) {
      // @cap-risk Malformed package.json silently ignored -- could produce incorrect convention report
    }
  }

  // --- tsconfig.json / jsconfig.json detection ---
  // @cap-context Reads TypeScript/JavaScript config for path aliases and module resolution
  const tsconfigPath = path.join(projectRoot, 'tsconfig.json');
  const jsconfigPath = path.join(projectRoot, 'jsconfig.json');
  const configPath = fs.existsSync(tsconfigPath) ? tsconfigPath : (fs.existsSync(jsconfigPath) ? jsconfigPath : null);

  if (configPath) {
    try {
      // Strip JS-style comments (// and /* */) before parsing — handles JSONC tsconfig files
      let raw = fs.readFileSync(configPath, 'utf8');
      raw = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      const config = JSON.parse(raw);
      if (config.compilerOptions && config.compilerOptions.paths) {
        report.pathAliases = config.compilerOptions.paths;
      }
    } catch (_e) {
      // Malformed config silently ignored
    }
  }

  // --- Directory structure detection ---
  // @cap-context Reads directory names to detect naming convention (kebab-case vs camelCase etc.)
  report.existingDirs = discoverDirectories(projectRoot, 3);
  report.namingConvention = detectNamingConvention(report.existingDirs);

  // --- Test pattern detection ---
  // @cap-decision Check for tests/ or __tests__/ directory first, then fall back to checking for colocated .test. files
  const hasTestsDir = report.existingDirs.some(d => d === 'tests' || d === '__tests__' || d.endsWith('/tests') || d.endsWith('/__tests__'));
  if (hasTestsDir) {
    report.testPattern = 'separate-dir';
  }
  // @cap-todo Detect colocated test pattern by scanning for *.test.* files alongside source files

  // --- Linter detection ---
  // @cap-context Checks for linter config files to match code style in generated skeleton
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
  // @cap-constraint Uses readdirSync (not glob) per project zero-dep constraint
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
  // @cap-decision Simple heuristic: check if majority of directory names match a pattern
  // @cap-risk Heuristic may misclassify projects with mixed naming -- returns 'unknown' when ambiguous
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

// @cap-feature(feature:F-044) Two-anchor probe -- right-sized convention discovery for Opus 4.7
// @cap-todo(ac:F-044/AC-3) Replace 6-7 file reads with a single high-signal probe (CLAUDE.md + package.json)
// @cap-risk(F-044) Edge case: projects without CLAUDE.md or with non-JSON package.json get null fields.
//   Mitigation: caller must handle null-valued anchors by either falling back to readProjectConventions()
//   for the legacy multi-file probe or letting the agent infer conventions from sample source files.

/**
 * @typedef {Object} ProjectAnchors
 * @property {string|null} rawClaudeMd - raw contents of CLAUDE.md, or null if absent
 * @property {string|null} rawPackageJson - raw contents of package.json (string, NOT parsed), or null if absent
 * @property {Object|null} parsedPackageJson - parsed JSON of package.json, or null if absent or invalid
 * @property {string} projectRoot - the absolute path probed
 * @property {string[]} filesProbed - the relative paths actually read (for token-cost auditability)
 */

/**
 * Reads the two highest-signal anchor files for project context: CLAUDE.md and package.json.
 *
 * This replaces readProjectConventions() in the right-sized Opus 4.7 workflow. The agent
 * infers the rest (linter, naming convention, test pattern, build tool) from these two
 * anchors plus a small number of sample source files chosen on demand at the call site,
 * rather than eagerly probing 6-7 config files up front.
 *
 * @param {string} projectRoot - absolute path to project root
 * @returns {ProjectAnchors}
 */
function probeProjectAnchors(projectRoot) {
  // @cap-todo(ac:F-044/AC-3) Implementation of the two-anchor probe -- exactly two file reads
  const result = {
    rawClaudeMd: null,
    rawPackageJson: null,
    parsedPackageJson: null,
    projectRoot,
    filesProbed: [],
  };

  // @cap-decision(F-044) Anchor 1: CLAUDE.md is the project's intent document. When present it
  //   captures conventions, tech stack, and constraints in one place -- higher signal than parsing
  //   .eslintrc + .prettierrc + tsconfig + biome.json individually.
  const claudePath = path.join(projectRoot, 'CLAUDE.md');
  if (fs.existsSync(claudePath)) {
    try {
      result.rawClaudeMd = fs.readFileSync(claudePath, 'utf8');
      result.filesProbed.push('CLAUDE.md');
    } catch (_e) {
      // @cap-risk(F-044) Permission errors silently ignored -- caller treats null rawClaudeMd as "no project intent doc"
    }
  }

  // @cap-decision(F-044) Anchor 2: package.json is the deterministic structural anchor (module type,
  //   scripts, dependencies). We expose BOTH the raw string (for audit/log purposes) and the parsed
  //   object (for programmatic use) so consumers don't need to re-parse.
  const pkgPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      result.rawPackageJson = fs.readFileSync(pkgPath, 'utf8');
      result.filesProbed.push('package.json');
      try {
        result.parsedPackageJson = JSON.parse(result.rawPackageJson);
      } catch (_parseErr) {
        // @cap-risk(F-044) Malformed package.json -- raw is preserved, parsed stays null. Caller must check.
      }
    } catch (_e) {
      // Permission errors silently ignored
    }
  }

  return result;
}

module.exports = { readProjectConventions, discoverDirectories, detectNamingConvention, probeProjectAnchors };
