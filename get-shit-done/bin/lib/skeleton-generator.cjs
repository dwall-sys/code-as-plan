// @gsd-context(phase:11) Skeleton generator -- produces directory tree and file list for architecture mode confirmation gate
// @gsd-decision This is a utility that generates the PLAN (tree display), not the files themselves. The agent creates files via Write tool after user confirms the plan.
// @gsd-ref(ref:ARCH-01) Supports skeleton generation with folder structure, config, and typed interfaces
// @gsd-ref(ref:ARCH-04) Generates preview for confirmation gate -- no files written until approved

'use strict';

const path = require('node:path');

// @gsd-api generateSkeletonPlan(conventions, modules) -- returns SkeletonPlan with tree string and file list
// @gsd-pattern Skeleton plans are data structures, not side-effectful -- file writing is done by the agent after user approval

/**
 * @typedef {Object} SkeletonFile
 * @property {string} relativePath - path relative to project root
 * @property {'config'|'interface'|'barrel'|'stub'|'entry'} type - file category
 * @property {string} purpose - one-line description for the tree display
 */

/**
 * @typedef {Object} SkeletonPlan
 * @property {string} tree - formatted directory tree string for display
 * @property {SkeletonFile[]} files - ordered list of files to create
 * @property {number} dirCount - number of directories in the skeleton
 * @property {number} configCount - number of config files
 * @property {number} interfaceCount - number of interface/type files
 * @property {number} boundaryCount - number of module boundary (barrel) files
 */

/**
 * Generates a skeleton plan from discovered conventions and a list of module names.
 *
 * @param {import('./convention-reader.cjs').ConventionReport} conventions
 * @param {string[]} moduleNames - names of top-level modules to create (e.g., ['tasks', 'users', 'database'])
 * @returns {SkeletonPlan}
 */
function generateSkeletonPlan(conventions, moduleNames) {
  // @gsd-todo(ref:AC-1) Implement skeleton plan generation that produces folder structure, config files, and typed interfaces based on discovered conventions
  // @gsd-constraint Generated skeleton must contain zero feature implementation code -- only structure and interfaces

  const files = [];
  const isEsm = conventions.moduleType === 'esm';

  // @gsd-decision Config files are generated first in the plan because they define project-wide conventions that module files depend on
  files.push({
    relativePath: 'package.json',
    type: 'config',
    purpose: 'Project manifest matching existing conventions',
  });

  if (conventions.pathAliases && Object.keys(conventions.pathAliases).length > 0) {
    files.push({
      relativePath: 'tsconfig.json',
      type: 'config',
      purpose: 'TypeScript config preserving existing path aliases',
    });
  }

  // @gsd-decision Entry point is src/index with extension matching module type (.mjs for ESM, .cjs for CJS, .js as default)
  const ext = isEsm ? '.js' : '.cjs';
  files.push({
    relativePath: `src/index${ext}`,
    type: 'entry',
    purpose: 'Main entry point -- re-exports all module boundaries',
  });

  // Shared types
  files.push({
    relativePath: `src/types/index${ext}`,
    type: 'interface',
    purpose: 'Shared type definitions used across module boundaries',
  });

  // @gsd-pattern Each module gets exactly three files: barrel (index), types, and a single stub
  // @gsd-decision Three-file module template keeps boundaries consistent and predictable across the codebase
  for (const moduleName of moduleNames) {
    // @gsd-context Module naming follows discovered convention (kebab-case, camelCase, etc.)
    const dirName = applyNamingConvention(moduleName, conventions.namingConvention);

    files.push({
      relativePath: `src/${dirName}/index${ext}`,
      type: 'barrel',
      purpose: `${moduleName} module boundary -- barrel export`,
    });

    files.push({
      relativePath: `src/${dirName}/types${ext}`,
      type: 'interface',
      purpose: `${moduleName} type definitions -- public API surface`,
    });

    files.push({
      relativePath: `src/${dirName}/stub${ext}`,
      type: 'stub',
      purpose: `${moduleName} implementation stub -- throws NotImplemented`,
    });
  }

  // Test structure
  // @gsd-decision Test directory structure matches discovered convention -- colocated or separate
  if (conventions.testPattern === 'separate-dir') {
    files.push({
      relativePath: 'tests/.gitkeep',
      type: 'config',
      purpose: 'Test directory placeholder matching existing test structure',
    });
  }

  const plan = {
    tree: buildTreeString(files),
    files,
    dirCount: countUniqueDirectories(files),
    configCount: files.filter(f => f.type === 'config').length,
    interfaceCount: files.filter(f => f.type === 'interface').length,
    boundaryCount: files.filter(f => f.type === 'barrel').length,
  };

  return plan;
}

/**
 * Applies the detected naming convention to a module name.
 * @param {string} name - module name in plain form (e.g., 'user auth')
 * @param {string} convention - detected convention
 * @returns {string}
 */
function applyNamingConvention(name, convention) {
  // @gsd-todo Implement naming convention transformations (kebab-case, camelCase, PascalCase, snake_case)
  const normalized = name.toLowerCase().replace(/\s+/g, '-');
  switch (convention) {
    case 'kebab-case':
      return normalized;
    case 'camelCase':
      return normalized.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    case 'PascalCase':
      return normalized.replace(/(^|-)([a-z])/g, (_, _sep, c) => c.toUpperCase());
    case 'snake_case':
      return normalized.replace(/-/g, '_');
    default:
      return normalized;
  }
}

/**
 * Builds a formatted directory tree string from a list of files.
 * @param {SkeletonFile[]} files
 * @returns {string}
 */
function buildTreeString(files) {
  // @gsd-todo Implement tree string builder with proper indentation and box-drawing characters
  // Stub: returns a simple flat listing
  const lines = ['project-root/'];
  for (const file of files) {
    const depth = file.relativePath.split('/').length - 1;
    const indent = '  '.repeat(depth + 1);
    const basename = path.basename(file.relativePath);
    lines.push(`${indent}${basename}  -- ${file.purpose}`);
  }
  return lines.join('\n');
}

/**
 * Counts unique directories from file paths.
 * @param {SkeletonFile[]} files
 * @returns {number}
 */
function countUniqueDirectories(files) {
  const dirs = new Set();
  for (const file of files) {
    const dir = path.dirname(file.relativePath);
    if (dir !== '.') dirs.add(dir);
  }
  return dirs.size;
}

// @gsd-api Exports: generateSkeletonPlan, applyNamingConvention (for testing)
module.exports = { generateSkeletonPlan, applyNamingConvention, buildTreeString };
