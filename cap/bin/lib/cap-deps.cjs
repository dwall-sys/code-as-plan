'use strict';

// @cap-feature(feature:F-049, primary:true) Automatic dependency inference from source imports.
// Scans tagged files for require/import statements, resolves them to feature IDs via the tag scanner,
// then diffs inferred against declared DEPENDS_ON in FEATURE-MAP.md.
//
// @cap-decision Regex-based import detection keeps the module zero-dep per CAP constraints.
// AST parsers (e.g. acorn, @babel/parser) would handle dynamic/conditional imports better but add
// a runtime dependency. Dynamic imports and computed requires are explicitly documented as limitations
// (F-049 AC-4).
// @cap-decision Pure logic by default — all functions take data in and return data out.
// The only I/O boundaries are `loadDepsConfig()` (reads .cap/config.json) and `applyInferredDeps()`
// (writes FEATURE-MAP.md). Every other function is testable without touching disk.

const fs = require('node:fs');
const path = require('node:path');

const CONFIG_FILE = path.join('.cap', 'config.json');

// @cap-todo(ac:F-049/AC-4) CJS `require('...')` — static string argument only (no template literals / vars)
const CJS_REQUIRE_RE = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

// @cap-todo(ac:F-049/AC-4) ESM `import ... from '...'` (default, named, namespace, and side-effect imports)
// @cap-risk The `^\s*` anchor guards the common case but does not strip block comments that span
// multiple lines. A `/* import x from './y' */` block inside multi-line JSDoc above real imports
// could yield a false positive. Acceptable for a zero-dep regex parser; document limitation.
const ESM_IMPORT_RE = /^\s*import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm;

// @cap-todo(ac:F-049/AC-4) ESM re-exports: `export ... from '...'`
// @cap-risk Same block-comment false-positive surface as ESM_IMPORT_RE above.
const ESM_REEXPORT_RE = /^\s*export\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm;

// @cap-todo(ac:F-049/AC-4) Dynamic imports: `import('...')` — static string arg only
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

// TS import types: `import type Foo from '...'` — captured by ESM_IMPORT_RE already.
// TS triple-slash references (/// <reference path="..." />) are doc-level, ignored on purpose.

const IMPORT_EXTENSIONS = ['.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx'];

/**
 * @typedef {Object} ImportSpec
 * @property {string} source - The raw import path as written (e.g. './foo', '../bar/baz.cjs')
 * @property {('cjs'|'esm'|'reexport'|'dynamic')} kind
 */

/**
 * @typedef {Object} DepsConfig
 * @property {boolean} enabled - Master switch for F-049 behaviour
 * @property {boolean} autoFix - Whether /cap:deps may write without --confirm
 */

const DEFAULT_CONFIG = {
  enabled: false,
  autoFix: false,
};

/**
 * Extract all static import/require specifiers from a source file's content.
 * Duplicates (same source path via different kinds) are preserved so callers can
 * see whether something is imported both via CJS and ESM in the same file.
 *
 * @param {string} content - Source file content
 * @returns {ImportSpec[]}
 */
function parseImports(content) {
  if (typeof content !== 'string' || content.length === 0) return [];
  const out = [];
  const sources = [
    [CJS_REQUIRE_RE, 'cjs'],
    [ESM_IMPORT_RE, 'esm'],
    [ESM_REEXPORT_RE, 'reexport'],
    [DYNAMIC_IMPORT_RE, 'dynamic'],
  ];
  for (const [re, kind] of sources) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content)) !== null) {
      out.push({ source: m[1], kind });
    }
  }
  return out;
}

/**
 * Resolve an import specifier to an absolute file path, Node-style.
 * Only relative/absolute imports are resolved — bare specifiers (e.g. 'node:fs',
 * 'react') return null because they map to node_modules/core, which cannot carry
 * CAP feature tags by definition.
 *
 * @param {string} importSource - The string from parseImports().source
 * @param {string} fromFile - Absolute path to the file containing the import
 * @returns {string|null} Absolute resolved path, or null when unresolvable
 */
function resolveImportToFile(importSource, fromFile) {
  if (!importSource || typeof importSource !== 'string') return null;

  // Bare specifier — package name or Node builtin. Not a CAP module.
  if (!importSource.startsWith('.') && !path.isAbsolute(importSource)) return null;

  const baseDir = path.dirname(fromFile);
  const absolute = path.isAbsolute(importSource)
    ? importSource
    : path.resolve(baseDir, importSource);

  // Try exact path first
  if (fileExistsSync(absolute)) return absolute;

  // Try extension suffixes
  for (const ext of IMPORT_EXTENSIONS) {
    const candidate = absolute + ext;
    if (fileExistsSync(candidate)) return candidate;
  }

  // Try directory index resolution: ./foo -> ./foo/index.{js,cjs,mjs,ts}
  if (dirExistsSync(absolute)) {
    for (const ext of IMPORT_EXTENSIONS) {
      const candidate = path.join(absolute, 'index' + ext);
      if (fileExistsSync(candidate)) return candidate;
    }
  }

  return null;
}

function fileExistsSync(p) {
  try {
    return fs.statSync(p).isFile();
  } catch (_e) {
    return false;
  }
}

function dirExistsSync(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch (_e) {
    return false;
  }
}

/**
 * Build a map from absolute file path -> feature ID, derived from tag scanner output.
 * A file with multiple @cap-feature tags is assigned its first listed feature.
 * Mirror files under .claude/ are treated as aliases of their counterparts under cap/
 * (both point to the same feature).
 *
 * @cap-todo(ac:F-049/AC-1) First-wins ownership is convenient but drops secondary feature
 * ownership silently. A future `@cap-feature(secondary:true)` convention could let a file
 * belong to multiple features without ambiguity; revisit this resolver at that time.
 *
 * @param {CapTag[]} tags - Output of scanner.scanDirectory()
 * @param {string} projectRoot - Absolute path to project root (for normalising tag.file)
 * @returns {Map<string, string>} absolute file path -> feature ID
 */
function buildFileToFeatureMap(tags, projectRoot) {
  const m = new Map();
  if (!Array.isArray(tags)) return m;
  for (const tag of tags) {
    if (tag.type !== 'feature') continue;
    const featureId = tag.metadata && tag.metadata.feature;
    if (!featureId) continue;
    const abs = path.isAbsolute(tag.file)
      ? tag.file
      : path.resolve(projectRoot, tag.file);
    if (!m.has(abs)) m.set(abs, featureId);
  }
  return m;
}

/**
 * @typedef {Object} InferredDeps
 * @property {Object<string, string[]>} byFeature - featureId -> [featureId] (dependency targets)
 * @property {Object<string, ImportEvidence[]>} evidence - featureId -> evidence rows explaining each inferred dep
 */

/**
 * @typedef {Object} ImportEvidence
 * @property {string} fromFile - File that made the import (relative to projectRoot)
 * @property {string} importSource - Raw import path as written
 * @property {string} resolvedFile - Absolute resolved path
 * @property {string} targetFeature - Feature ID the resolved file is tagged with
 * @property {('cjs'|'esm'|'reexport'|'dynamic')} kind
 */

/**
 * Infer feature-level dependencies from source imports.
 * For every tagged source file, parse its imports, resolve them, and map each
 * resolved target to a feature ID. If the source file's feature imports from a
 * file owned by another feature, that is an inferred dependency.
 *
 * Self-imports (same feature) are filtered out.
 *
 * @param {CapTag[]} tags - Output of scanner.scanDirectory()
 * @param {string} projectRoot - Absolute path to project root
 * @param {{ readFile?: (p: string) => string, resolveImport?: (source: string, fromFile: string) => string|null }} [opts] - Optional hooks for testing
 * @returns {InferredDeps}
 */
function inferFeatureDeps(tags, projectRoot, opts) {
  const readFile = (opts && opts.readFile) || ((p) => fs.readFileSync(p, 'utf8'));
  const resolve = (opts && opts.resolveImport) || resolveImportToFile;
  const fileToFeature = buildFileToFeatureMap(tags, projectRoot);

  const byFeature = {};
  const evidence = {};

  for (const [absFile, featureId] of fileToFeature.entries()) {
    let content;
    try {
      content = readFile(absFile);
    } catch (_e) {
      continue; // file unreadable — no evidence for this path
    }
    const imports = parseImports(content);
    for (const imp of imports) {
      const resolved = resolve(imp.source, absFile);
      if (!resolved) continue;
      const targetFeature = fileToFeature.get(resolved);
      if (!targetFeature) continue;
      if (targetFeature === featureId) continue; // self-import, not a dep

      if (!byFeature[featureId]) byFeature[featureId] = [];
      if (!byFeature[featureId].includes(targetFeature)) {
        byFeature[featureId].push(targetFeature);
      }

      if (!evidence[featureId]) evidence[featureId] = [];
      evidence[featureId].push({
        fromFile: path.relative(projectRoot, absFile),
        importSource: imp.source,
        resolvedFile: resolved,
        targetFeature,
        kind: imp.kind,
      });
    }
  }

  // Stable order: sort dependency lists alphabetically to keep diff output deterministic
  for (const f of Object.keys(byFeature)) byFeature[f].sort();

  return { byFeature, evidence };
}

/**
 * @typedef {Object} DepDiffRow
 * @property {string} feature - Feature ID under review
 * @property {string[]} declared - Deps declared in FEATURE-MAP.md
 * @property {string[]} inferred - Deps inferred from imports
 * @property {string[]} missing - In `inferred` but not in `declared` (should be added)
 * @property {string[]} extraneous - In `declared` but not in `inferred` (candidates for removal)
 */

// @cap-todo(ac:F-049/AC-2) Diff declared vs inferred dependencies per feature.
/**
 * Compare the FEATURE-MAP.md declared dependencies against the inferred set.
 * Returns one row per feature that appears in either source; features with
 * perfectly matching sets are included with empty missing/extraneous arrays so
 * callers can decide whether to filter.
 *
 * @param {FeatureMap} featureMap - Output of cap-feature-map.readFeatureMap()
 * @param {InferredDeps} inferred
 * @returns {DepDiffRow[]}
 */
function diffDeclaredVsInferred(featureMap, inferred) {
  const rows = [];
  const features = (featureMap && featureMap.features) || [];
  const inferredByFeature = inferred && inferred.byFeature ? inferred.byFeature : {};

  const seen = new Set();
  for (const f of features) {
    const declared = Array.isArray(f.dependencies) ? [...f.dependencies].sort() : [];
    const inferredList = inferredByFeature[f.id] ? [...inferredByFeature[f.id]].sort() : [];
    const missing = inferredList.filter((d) => !declared.includes(d));
    const extraneous = declared.filter((d) => !inferredList.includes(d));
    rows.push({
      feature: f.id,
      declared,
      inferred: inferredList,
      missing,
      extraneous,
    });
    seen.add(f.id);
  }

  // Features that exist in inferred but not in the FEATURE-MAP at all —
  // possible when scanning picks up unregistered feature IDs from tags.
  for (const fid of Object.keys(inferredByFeature)) {
    if (seen.has(fid)) continue;
    rows.push({
      feature: fid,
      declared: [],
      inferred: [...inferredByFeature[fid]].sort(),
      missing: [...inferredByFeature[fid]].sort(),
      extraneous: [],
    });
  }

  rows.sort((a, b) => a.feature.localeCompare(b.feature));
  return rows;
}

/**
 * Produce a human-readable summary for /cap:deps without --graph.
 * @param {DepDiffRow[]} diffRows
 * @returns {string}
 */
function formatDiffReport(diffRows) {
  const changed = diffRows.filter((r) => r.missing.length > 0 || r.extraneous.length > 0);
  if (changed.length === 0) {
    return 'Dependency graph is consistent — no changes inferred.';
  }
  const lines = [];
  lines.push(`Dependency drift detected in ${changed.length} feature(s):`);
  lines.push('');
  for (const row of changed) {
    lines.push(`${row.feature}`);
    lines.push(`  declared:  ${row.declared.length ? row.declared.join(', ') : '(none)'}`);
    lines.push(`  inferred:  ${row.inferred.length ? row.inferred.join(', ') : '(none)'}`);
    if (row.missing.length) lines.push(`  + add:     ${row.missing.join(', ')}`);
    if (row.extraneous.length) lines.push(`  - remove?: ${row.extraneous.join(', ')}`);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

// @cap-todo(ac:F-049/AC-5) Render a Mermaid flowchart of feature -> feature edges.
/**
 * Render a Mermaid flowchart of feature dependencies. Nodes are labelled
 * with the feature ID + first 30 chars of title (when available).
 *
 * @param {FeatureMap} featureMap
 * @param {InferredDeps} inferred
 * @param {{ source?: 'inferred'|'declared'|'union' }} [opts] - Which edge set to render; default 'union'
 * @returns {string} Mermaid source (starting with ```mermaid fence)
 */
function renderMermaidGraph(featureMap, inferred, opts) {
  const source = (opts && opts.source) || 'union';
  const features = (featureMap && featureMap.features) || [];
  const inferredByFeature = inferred && inferred.byFeature ? inferred.byFeature : {};

  const lines = ['```mermaid', 'flowchart TD'];

  // Nodes
  const idToTitle = {};
  for (const f of features) {
    idToTitle[f.id] = f.title || f.id;
    const label = truncate(`${f.id}: ${idToTitle[f.id]}`, 40);
    lines.push(`  ${nodeId(f.id)}["${escapeLabel(label)}"]`);
  }

  // Edges
  const seen = new Set();
  const pushEdge = (from, to, kind) => {
    const key = `${from}->${to}:${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    const arrow = kind === 'inferred-only' ? '-.->|inferred|' : '-->';
    lines.push(`  ${nodeId(from)} ${arrow} ${nodeId(to)}`);
  };

  for (const f of features) {
    const declared = Array.isArray(f.dependencies) ? f.dependencies : [];
    const inferredList = inferredByFeature[f.id] || [];
    if (source === 'declared' || source === 'union') {
      for (const d of declared) pushEdge(f.id, d, 'declared');
    }
    if (source === 'inferred' || source === 'union') {
      for (const d of inferredList) {
        const isOnlyInferred = !declared.includes(d);
        pushEdge(f.id, d, isOnlyInferred ? 'inferred-only' : 'declared');
      }
    }
  }

  lines.push('```');
  return lines.join('\n');
}

function nodeId(featureId) {
  return featureId.replace(/[^a-zA-Z0-9]/g, '_');
}

function escapeLabel(s) {
  return String(s).replace(/"/g, '\\"');
}

function truncate(s, n) {
  if (s.length <= n) return s;
  return s.slice(0, Math.max(0, n - 1)) + '…';
}

// @cap-todo(ac:F-049/AC-6) Load F-049 config from .cap/config.json with safe defaults.
/**
 * Load F-049 config from .cap/config.json. Returns defaults if file missing or
 * autoDepsInference section absent.
 * @param {string} cwd
 * @returns {DepsConfig}
 */
function loadDepsConfig(cwd) {
  const configPath = path.join(cwd, CONFIG_FILE);
  let cfg = { ...DEFAULT_CONFIG };
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    const section = parsed && parsed.autoDepsInference;
    if (section && typeof section === 'object') {
      if (typeof section.enabled === 'boolean') cfg.enabled = section.enabled;
      if (typeof section.autoFix === 'boolean') cfg.autoFix = section.autoFix;
    }
  } catch (_e) {
    // No config or malformed — use defaults
  }
  return cfg;
}

// @cap-todo(ac:F-049/AC-3) Apply inferred deps to FEATURE-MAP.md — requires confirmation callback.
/**
 * Write inferred dependencies back to FEATURE-MAP.md by replacing each feature's
 * `**Depends on:**` line (or inserting one directly under the feature header if
 * none exists). Extraneous declared deps are removed when removeExtraneous is true.
 *
 * @param {string} cwd - Project root
 * @param {DepDiffRow[]} diffRows - Output of diffDeclaredVsInferred
 * @param {{ removeExtraneous?: boolean, featureMapPath?: string }} [opts]
 * @returns {{ updated: string[], unchanged: string[] }}
 */
function applyInferredDeps(cwd, diffRows, opts) {
  const options = opts || {};
  const removeExtraneous = options.removeExtraneous === true;
  const featureMapPath = options.featureMapPath || path.join(cwd, 'FEATURE-MAP.md');

  const original = fs.readFileSync(featureMapPath, 'utf8');
  let updated = original;
  const changedFeatures = [];
  const unchangedFeatures = [];

  for (const row of diffRows) {
    const shouldWrite = row.missing.length > 0 || (removeExtraneous && row.extraneous.length > 0);
    if (!shouldWrite) {
      unchangedFeatures.push(row.feature);
      continue;
    }

    const mergedSet = new Set([...row.declared, ...row.missing]);
    if (removeExtraneous) {
      for (const ext of row.extraneous) mergedSet.delete(ext);
    }
    const merged = [...mergedSet].sort();
    const newLine = merged.length > 0 ? `**Depends on:** ${merged.join(', ')}` : '';

    const next = rewriteDependsOnLine(updated, row.feature, newLine);
    if (next === updated) {
      unchangedFeatures.push(row.feature);
    } else {
      updated = next;
      changedFeatures.push(row.feature);
    }
  }

  if (updated !== original) fs.writeFileSync(featureMapPath, updated, 'utf8');
  return { updated: changedFeatures, unchanged: unchangedFeatures };
}

/**
 * Rewrite the `**Depends on:**` line within a single feature block, inserting
 * one directly below the feature header if it does not already exist. Pure
 * string manipulation so it is unit-testable without touching disk.
 *
 * @param {string} contents - Full FEATURE-MAP.md markdown
 * @param {string} featureId - e.g. 'F-049'
 * @param {string} newLine - Full line content (without trailing newline), or '' to remove
 * @returns {string} Updated markdown (unchanged if featureId not found)
 */
function rewriteDependsOnLine(contents, featureId, newLine) {
  const lines = contents.split('\n');
  // Feature header: `### F-049: Title [state]`
  const headerRE = new RegExp(`^###\\s+${escapeRe(featureId)}(?::|\\s|$)`);
  const nextHeaderRE = /^###\s+F-\d{3}/;
  const dependsRE = /^-?\s*\*\*Depend(?:s on|encies):\*\*/;

  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headerRE.test(lines[i])) { start = i; break; }
  }
  if (start === -1) return contents;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (nextHeaderRE.test(lines[i])) { end = i; break; }
  }

  // Try to find an existing Depends on line inside the block
  let depIdx = -1;
  for (let i = start + 1; i < end; i++) {
    if (dependsRE.test(lines[i])) { depIdx = i; break; }
  }

  if (depIdx !== -1) {
    if (newLine === '') {
      // Remove the line (and a possibly blank line immediately after)
      const removeCount = (lines[depIdx + 1] === '') ? 2 : 1;
      lines.splice(depIdx, removeCount);
    } else {
      lines[depIdx] = newLine;
    }
  } else if (newLine !== '') {
    // Insert directly after the blank line that follows the feature header.
    // Pattern: header \n "" \n <insert here>  — do not add a second blank line.
    if (lines[start + 1] === '') {
      lines.splice(start + 2, 0, newLine, '');
    } else {
      lines.splice(start + 1, 0, '', newLine, '');
    }
  }

  return lines.join('\n');
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  // pure helpers (exported for tests)
  parseImports,
  resolveImportToFile,
  buildFileToFeatureMap,
  rewriteDependsOnLine,
  // high-level API
  inferFeatureDeps,
  diffDeclaredVsInferred,
  formatDiffReport,
  renderMermaidGraph,
  loadDepsConfig,
  applyInferredDeps,
  // constants (for tests / consumers)
  DEFAULT_CONFIG,
  IMPORT_EXTENSIONS,
};
