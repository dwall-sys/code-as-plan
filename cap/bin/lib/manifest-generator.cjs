// @cap-context Manifest generator for monorepo shared packages -- extracts public API surface and produces markdown summaries
// @cap-decision Scans index/barrel files and TypeScript .d.ts files rather than full AST parsing -- regex is sufficient for export extraction
// @cap-constraint Zero external dependencies -- uses only Node.js built-ins (fs, path)
// @cap-ref(ref:AC-5) Shared packages get auto-generated API manifests stored in root .planning/manifests/
// @cap-pattern Manifest output is markdown so it can be injected directly into agent context as lightweight reference

'use strict';

// @cap-feature(feature:F-012) Monorepo Support — API manifest generator for shared packages

const fs = require('node:fs');
const path = require('node:path');

// @cap-api generateManifest(packagePath, options) -- returns ManifestData object with exports, types, and description

/**
 * @typedef {Object} ExportEntry
 * @property {string} name - Exported symbol name
 * @property {'function'|'class'|'const'|'type'|'interface'|'enum'|'default'|'unknown'} kind - Export kind
 * @property {string|null} description - One-line description if available from JSDoc/comment
 */

/**
 * @typedef {Object} ManifestData
 * @property {string} packageName - Package name from package.json
 * @property {string} packagePath - Relative path in monorepo
 * @property {string|null} description - Package description from package.json
 * @property {string|null} version - Package version
 * @property {ExportEntry[]} exports - Public API exports
 * @property {string[]} dependencies - Internal monorepo dependencies (workspace:*)
 * @property {string} generatedAt - ISO timestamp
 */

/**
 * Generate a manifest for a single shared package.
 *
 * @param {string} packageAbsPath - Absolute path to the package directory
 * @param {Object} [options]
 * @param {string} [options.rootPath] - Monorepo root for computing relative paths
 * @returns {ManifestData}
 */
function generateManifest(packageAbsPath, options) {
  options = options || {};
  const rootPath = options.rootPath || path.dirname(path.dirname(packageAbsPath));

  const pkgJsonPath = path.join(packageAbsPath, 'package.json');
  const pkg = safeReadJson(pkgJsonPath) || {};

  const manifest = {
    packageName: pkg.name || path.basename(packageAbsPath),
    packagePath: path.relative(rootPath, packageAbsPath),
    description: pkg.description || null,
    version: pkg.version || null,
    exports: [],
    dependencies: [],
    generatedAt: new Date().toISOString(),
  };

  // @cap-decision Extract workspace:* dependencies to identify internal monorepo links
  manifest.dependencies = extractWorkspaceDeps(pkg);

  // @cap-context Find and scan the main entry point / barrel file for exports
  const entryFile = resolveEntryFile(packageAbsPath, pkg);
  if (entryFile) {
    manifest.exports = scanExports(entryFile);
  } else {
    // Fallback: scan .d.ts files for TypeScript type exports when no barrel file is found
    const dtsExports = scanDtsFiles(packageAbsPath);
    manifest.exports = dtsExports;
  }

  return manifest;
}

/**
 * Resolve the main entry/barrel file for a package.
 *
 * @param {string} packageAbsPath
 * @param {Object} pkg - Parsed package.json
 * @returns {string|null} Absolute path to entry file, or null
 */
function resolveEntryFile(packageAbsPath, pkg) {
  // @cap-decision Check package.json exports/main/module fields, then fall back to index.ts/index.js convention
  const candidates = [];

  // From package.json fields
  if (pkg.exports && typeof pkg.exports === 'string') {
    candidates.push(pkg.exports);
  } else if (pkg.exports && pkg.exports['.']) {
    const dotExport = pkg.exports['.'];
    if (typeof dotExport === 'string') candidates.push(dotExport);
    else if (dotExport.import) candidates.push(dotExport.import);
    else if (dotExport.require) candidates.push(dotExport.require);
    else if (dotExport.default) candidates.push(dotExport.default);
  }
  if (pkg.main) candidates.push(pkg.main);
  if (pkg.module) candidates.push(pkg.module);

  // Convention-based fallbacks
  candidates.push('src/index.ts', 'src/index.tsx', 'src/index.js', 'index.ts', 'index.js', 'lib/index.ts', 'lib/index.js');

  for (const candidate of candidates) {
    const absCandidate = path.join(packageAbsPath, candidate);
    if (fs.existsSync(absCandidate)) {
      return absCandidate;
    }
  }

  return null;
}

/**
 * Scan a file for export statements and extract public API entries.
 *
 * @param {string} filePath - Absolute path to the file
 * @returns {ExportEntry[]}
 */
function scanExports(filePath) {
  // @cap-decision Use regex to extract exports rather than AST parsing -- language-agnostic and zero-dep
  // @cap-risk Regex export extraction may miss complex re-export patterns like `export * from './module'` chains
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }

  const exports = [];

  // Named exports: export function foo, export class Bar, export const baz, export type Qux
  const namedExportRe = /^[ \t]*export\s+(function|class|const|let|var|type|interface|enum|abstract\s+class)\s+(\w+)/gm;
  for (const match of content.matchAll(namedExportRe)) {
    let kind = match[1].trim();
    if (kind === 'let' || kind === 'var') kind = 'const';
    if (kind.startsWith('abstract')) kind = 'class';

    const name = match[2];
    const description = extractPrecedingComment(content, match.index);

    exports.push({ name, kind, description });
  }

  // Default export: export default function/class
  const defaultExportRe = /^[ \t]*export\s+default\s+(function|class)\s+(\w+)?/gm;
  for (const match of content.matchAll(defaultExportRe)) {
    exports.push({
      name: match[2] || 'default',
      kind: 'default',
      description: extractPrecedingComment(content, match.index),
    });
  }

  // Re-exports: export { Foo, Bar } from './module'
  const reExportRe = /^[ \t]*export\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"]/gm;
  for (const match of content.matchAll(reExportRe)) {
    const names = match[1].split(',').map(n => n.trim().split(/\s+as\s+/).pop().trim()).filter(Boolean);
    for (const name of names) {
      exports.push({ name, kind: 'unknown', description: null });
    }
  }

  return exports;
}

/**
 * Extract the first line of a comment block immediately preceding a given position.
 *
 * @param {string} content - Full file content
 * @param {number} position - Character position of the export statement
 * @returns {string|null}
 */
function extractPrecedingComment(content, position) {
  // Look at lines immediately above the export
  const before = content.slice(0, position);
  const lines = before.split('\n');
  const lastLine = lines[lines.length - 1];

  // Check the line above (lines.length - 2 because last element is partial line)
  if (lines.length < 2) return null;
  const prevLine = lines[lines.length - 2].trim();

  // Single-line comment
  if (prevLine.startsWith('//')) {
    return prevLine.replace(/^\/\/\s*/, '').trim() || null;
  }
  // Block comment end
  if (prevLine.endsWith('*/')) {
    const commentText = prevLine.replace(/^\*\/?\s*|\s*\*\/$/g, '').replace(/^\*\s*/, '').trim();
    return commentText || null;
  }
  // JSDoc @description or first line
  if (prevLine.startsWith('*')) {
    return prevLine.replace(/^\*\s*/, '').replace(/@\w+\s*/, '').trim() || null;
  }

  return null;
}

/**
 * Extract workspace:* dependencies from package.json.
 *
 * @param {Object} pkg - Parsed package.json
 * @returns {string[]} List of internal package names
 */
function extractWorkspaceDeps(pkg) {
  const deps = [];
  const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}), ...(pkg.peerDependencies || {}) };

  for (const [name, version] of Object.entries(allDeps)) {
    if (typeof version === 'string' && version.startsWith('workspace:')) {
      deps.push(name);
    }
  }

  return deps;
}

/**
 * Format a ManifestData object as a markdown document.
 *
 * @param {ManifestData} manifest
 * @returns {string}
 */
function formatManifestMarkdown(manifest) {
  const lines = [
    `# ${manifest.packageName}`,
    ``,
    `**Path:** ${manifest.packagePath}`,
    `**Version:** ${manifest.version || 'n/a'}`,
    `**Generated:** ${manifest.generatedAt}`,
    ``,
  ];

  if (manifest.description) {
    lines.push(`> ${manifest.description}`, ``);
  }

  // Exports table
  if (manifest.exports.length > 0) {
    lines.push(`## Exports`, ``);
    lines.push(`| Name | Kind | Description |`);
    lines.push(`|------|------|-------------|`);
    for (const exp of manifest.exports) {
      lines.push(`| ${exp.name} | ${exp.kind} | ${exp.description || '--'} |`);
    }
    lines.push(``);
  } else {
    lines.push(`## Exports`, ``, `No exports detected.`, ``);
  }

  // Internal dependencies
  if (manifest.dependencies.length > 0) {
    lines.push(`## Internal Dependencies`, ``);
    for (const dep of manifest.dependencies) {
      lines.push(`- ${dep}`);
    }
    lines.push(``);
  }

  return lines.join('\n');
}

/**
 * Generate manifests for all packages in a workspace and write them to .planning/manifests/.
 *
 * @param {string} rootPath - Monorepo root
 * @param {Array<{name: string, path: string, absolutePath: string}>} packages - Workspace packages
 * @param {Object} [options]
 * @param {string} [options.outputDir] - Override manifest output directory
 * @returns {string[]} Paths to generated manifest files
 */
// @cap-api generateAllManifests(rootPath, packages, options) -- writes markdown manifests to .planning/manifests/ and returns file paths
function generateAllManifests(rootPath, packages, options) {
  options = options || {};
  const outputDir = options.outputDir || path.join(rootPath, '.planning', 'manifests');

  fs.mkdirSync(outputDir, { recursive: true });

  const writtenFiles = [];

  for (const pkg of packages) {
    const manifest = generateManifest(pkg.absolutePath, { rootPath });
    const markdown = formatManifestMarkdown(manifest);
    const safeName = manifest.packageName.replace(/^@/, '').replace(/\//g, '__');
    const outFile = path.join(outputDir, `${safeName}.md`);

    fs.writeFileSync(outFile, markdown, 'utf-8');
    writtenFiles.push(outFile);
  }

  return writtenFiles;
}

/**
 * CLI entry point for generate-manifest subcommand.
 *
 * @param {string} cwd - Current working directory
 * @param {string} packagePath - Relative path to the package
 * @param {boolean} raw - Whether to output raw JSON
 */
function cmdGenerateManifest(cwd, packagePath, raw) {
  if (!packagePath) {
    process.stderr.write('Usage: generate-manifest <package-path>\n');
    process.exitCode = 1;
    return;
  }

  const absPath = path.resolve(cwd, packagePath);
  const manifest = generateManifest(absPath, { rootPath: cwd });

  if (raw) {
    process.stdout.write(JSON.stringify(manifest, null, 2) + '\n');
  } else {
    process.stdout.write(formatManifestMarkdown(manifest) + '\n');
  }
}

/**
 * Scan .d.ts files in a package root and src/ for type exports.
 * Limited to first 5 .d.ts files to bound scan time.
 *
 * @param {string} packageAbsPath - Absolute path to package directory
 * @returns {ExportEntry[]}
 */
function scanDtsFiles(packageAbsPath) {
  const dtsFiles = [];

  // Collect .d.ts files from package root and src/
  const dirsToScan = [packageAbsPath, path.join(packageAbsPath, 'src')];
  for (const dir of dirsToScan) {
    try {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        if (entry.endsWith('.d.ts') && entry !== 'node_modules') {
          dtsFiles.push(path.join(dir, entry));
        }
        if (dtsFiles.length >= 5) break;
      }
    } catch {
      // Directory does not exist or not readable
    }
    if (dtsFiles.length >= 5) break;
  }

  // Scan each .d.ts file and merge exports, deduplicate by name
  const allExports = [];
  const seenNames = new Set();
  for (const dtsFile of dtsFiles) {
    const exports = scanExports(dtsFile);
    for (const exp of exports) {
      if (!seenNames.has(exp.name)) {
        seenNames.add(exp.name);
        allExports.push(exp);
      }
    }
  }

  return allExports;
}

/**
 * Safely read and parse a JSON file.
 * @param {string} filePath
 * @returns {Object|null}
 */
function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

module.exports = {
  generateManifest,
  generateAllManifests,
  formatManifestMarkdown,
  scanExports,
  scanDtsFiles,
  resolveEntryFile,
  extractWorkspaceDeps,
  cmdGenerateManifest,
};
