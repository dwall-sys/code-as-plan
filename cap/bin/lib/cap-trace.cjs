// @cap-context CAP v2.0 trace module — implements `/cap:trace AC-N` by walking the call graph from the primary file of an AC across its referenced files.
// @cap-decision Separated from cap-tag-scanner.cjs because: (a) scanner is already 800+ lines and approaching the 300-line guideline boundary at function level; (b) trace requires file IO + import resolution that the pure-aggregation scanner avoids; (c) splitting lets us test the call-graph walker in isolation.
// @cap-decision Designated as the primary implementation file for F-045 — `primary:true` tag below. The scanner extension in cap-tag-scanner.cjs is supporting infrastructure that F-045 reuses.

'use strict';

// @cap-feature(feature:F-045, primary:true) Trace AC-to-Code call graph from the primary file across referenced files.

const fs = require('node:fs');
const path = require('node:path');
const { scanDirectory, buildAcFileMap } = require('./cap-tag-scanner.cjs');

// @cap-decision Trace depth defaults to 3 hops. Justification: 1 hop is too shallow to see indirect collaborators, 2 misses common library wrapper patterns, 3 catches transitive dependencies one level past wrappers. Depth >3 explodes output size and rarely surfaces useful traceability information; users who want full graphs should use a dedicated dependency tool.
const DEFAULT_MAX_DEPTH = 3;

// Regex captures both CommonJS require() and ES module static imports.
// @cap-risk Dynamic imports (require(variable), import(expr)) and conditional requires inside functions cannot be detected by a static regex — they will silently be omitted from the call graph. This is documented in the trace output.
// @cap-risk TypeScript path aliases (e.g. "@/utils") cannot be resolved without reading tsconfig.json — out of scope for F-045; the edge will be marked external.
const REQUIRE_RE = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;
const IMPORT_RE = /^\s*import\b[^'"]*['"]([^'"]+)['"]/gm;
const EXPORT_FROM_RE = /^\s*export\b[^'"]*from\s+['"]([^'"]+)['"]/gm;

const CODE_EXTENSIONS = ['.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx'];

/**
 * @typedef {Object} CallGraphEdge
 * @property {string} from - Source file (relative to project root)
 * @property {string} to - Target file (relative to project root, or external module name)
 * @property {('require'|'import'|'export-from')} type - How the edge was declared
 * @property {number} line - Line number in `from` where the edge is declared
 * @property {boolean} external - True if `to` could not be resolved to a project file
 */

/**
 * @typedef {Object} TraceResult
 * @property {string} featureId - e.g. "F-045"
 * @property {string} acId - e.g. "AC-1"
 * @property {string} key - Composite "F-045/AC-1"
 * @property {{file: string|null, role: ('designated'|'inferred'|null)}} primary
 * @property {string[]} allFiles - Every file contributing tags to this AC
 * @property {CallGraphEdge[]} callGraph - Edges discovered from primary outward (BFS, deduped)
 * @property {string[]} warnings - Human-readable warnings (heuristic primary, missing AC, etc.)
 * @property {number} depthLimit - Max BFS depth used
 */

// @cap-api resolveImport(spec, fromAbsFile, projectRoot) -- Resolve an import specifier to an absolute file inside the project, or null if external.
// @cap-decision Resolution is intentionally minimal: only relative paths are resolved (./, ../). Bare specifiers (npm packages, TS aliases) are treated as external. This matches how F-045 trace is meant to be used — to map intra-project AC implementations, not to chase node_modules.
/**
 * @param {string} spec - Raw import/require specifier
 * @param {string} fromAbsFile - Absolute path of the file containing the import
 * @param {string} projectRoot - Absolute project root
 * @returns {string|null} - Absolute path inside project, or null if unresolvable / external
 */
function resolveImport(spec, fromAbsFile, projectRoot) {
  if (!spec.startsWith('./') && !spec.startsWith('../')) return null;
  const fromDir = path.dirname(fromAbsFile);
  const baseAbs = path.resolve(fromDir, spec);

  // Reject anything outside project root.
  const rel = path.relative(projectRoot, baseAbs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;

  // Try direct file
  if (fs.existsSync(baseAbs) && fs.statSync(baseAbs).isFile()) return baseAbs;

  // Try with code extensions
  for (const ext of CODE_EXTENSIONS) {
    const withExt = baseAbs + ext;
    if (fs.existsSync(withExt) && fs.statSync(withExt).isFile()) return withExt;
  }

  // Try as directory with index file
  if (fs.existsSync(baseAbs) && fs.statSync(baseAbs).isDirectory()) {
    for (const ext of CODE_EXTENSIONS) {
      const indexFile = path.join(baseAbs, 'index' + ext);
      if (fs.existsSync(indexFile) && fs.statSync(indexFile).isFile()) return indexFile;
    }
  }

  return null;
}

// @cap-api extractEdges(absFile, projectRoot) -- Extract require/import/export-from edges from a single file.
/**
 * @param {string} absFile - Absolute file path to scan
 * @param {string} projectRoot - Absolute project root
 * @returns {CallGraphEdge[]}
 */
function extractEdges(absFile, projectRoot) {
  let content;
  try {
    content = fs.readFileSync(absFile, 'utf8');
  } catch (_e) {
    return [];
  }
  const fromRel = path.relative(projectRoot, absFile);
  const lines = content.split('\n');
  const edges = [];

  // Walk line-by-line so we can capture line numbers.
  // @cap-decision Line-by-line over multi-line regex on full content because per-line iteration gives us cheap accurate line numbers without computing offsets.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    REQUIRE_RE.lastIndex = 0;
    let m;
    while ((m = REQUIRE_RE.exec(line)) !== null) {
      const spec = m[1];
      const resolved = resolveImport(spec, absFile, projectRoot);
      edges.push({
        from: fromRel,
        to: resolved ? path.relative(projectRoot, resolved) : spec,
        type: 'require',
        line: i + 1,
        external: !resolved,
      });
    }
    // For import / export-from regex, run on the whole line as well.
    IMPORT_RE.lastIndex = 0;
    while ((m = IMPORT_RE.exec(line)) !== null) {
      const spec = m[1];
      const resolved = resolveImport(spec, absFile, projectRoot);
      edges.push({
        from: fromRel,
        to: resolved ? path.relative(projectRoot, resolved) : spec,
        type: 'import',
        line: i + 1,
        external: !resolved,
      });
    }
    EXPORT_FROM_RE.lastIndex = 0;
    while ((m = EXPORT_FROM_RE.exec(line)) !== null) {
      const spec = m[1];
      const resolved = resolveImport(spec, absFile, projectRoot);
      edges.push({
        from: fromRel,
        to: resolved ? path.relative(projectRoot, resolved) : spec,
        type: 'export-from',
        line: i + 1,
        external: !resolved,
      });
    }
  }

  return edges;
}

// @cap-api walkCallGraph(rootRelFile, projectRoot, options) -- BFS walk of import/require edges from a root file.
// @cap-todo(ac:F-045/AC-4) Walk the call graph from the primary file across referenced files for a given AC.
/**
 * Breadth-first traversal of import/require edges starting at the given file.
 * Returns a deduped, depth-limited list of edges.
 *
 * @param {string} rootRelFile - Relative path of starting file
 * @param {string} projectRoot - Absolute project root
 * @param {Object} [options]
 * @param {number} [options.maxDepth] - Max hops (default 3)
 * @param {Set<string>} [options.allowedFiles] - If set, restrict traversal to these relative paths plus their immediate edges
 * @returns {CallGraphEdge[]}
 */
function walkCallGraph(rootRelFile, projectRoot, options = {}) {
  const maxDepth = Number.isFinite(options.maxDepth) ? options.maxDepth : DEFAULT_MAX_DEPTH;
  const allowedFiles = options.allowedFiles || null;

  const edges = [];
  const seen = new Set(); // file:line:type:to
  const visited = new Set(); // visited files

  /** @type {Array<{file: string, depth: number}>} */
  const queue = [{ file: rootRelFile, depth: 0 }];

  while (queue.length > 0) {
    const { file, depth } = queue.shift();
    if (visited.has(file)) continue;
    visited.add(file);
    if (depth >= maxDepth) continue;

    const absFile = path.resolve(projectRoot, file);
    if (!fs.existsSync(absFile)) continue;
    const fileEdges = extractEdges(absFile, projectRoot);
    for (const edge of fileEdges) {
      const dedupeKey = `${edge.from}:${edge.line}:${edge.type}:${edge.to}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      edges.push(edge);

      // Enqueue resolved internal targets for further traversal.
      // @cap-decision Skip external edges for traversal but keep them in the output — they are useful documentation of "what this AC depends on" without bloating the graph.
      if (!edge.external) {
        if (allowedFiles && !allowedFiles.has(edge.to)) {
          // Outside the AC scope — record the edge but don't recurse into it.
          continue;
        }
        queue.push({ file: edge.to, depth: depth + 1 });
      }
    }
  }

  return edges;
}

// @cap-api traceAc(projectRoot, acRef, options) -- Build a TraceResult for the given AC reference.
// @cap-todo(ac:F-045/AC-4) /cap:trace AC-N command shall print the call graph from the primary file.
/**
 * Trace the call graph for an AC across its contributing files.
 *
 * @param {string} projectRoot - Absolute project root
 * @param {string} acRef - "F-NNN/AC-M" or just "AC-M" (caller must resolve feature)
 * @param {Object} [options]
 * @param {number} [options.maxDepth] - Max BFS depth (default 3)
 * @param {boolean} [options.restrictToAcFiles] - Only follow edges into other AC-contributing files (default false)
 * @param {CapTag[]} [options.tags] - Pre-scanned tags (for testing); if omitted, scans projectRoot fresh
 * @returns {TraceResult}
 */
function traceAc(projectRoot, acRef, options = {}) {
  const maxDepth = Number.isFinite(options.maxDepth) ? options.maxDepth : DEFAULT_MAX_DEPTH;

  // Normalize key — caller may pass "AC-1" without feature prefix; we cannot resolve that without context.
  if (!acRef || typeof acRef !== 'string') {
    return {
      featureId: null,
      acId: null,
      key: acRef,
      primary: { file: null, role: null },
      allFiles: [],
      callGraph: [],
      warnings: ['Invalid AC reference: must be a non-empty string like "F-045/AC-1"'],
      depthLimit: maxDepth,
    };
  }
  if (!acRef.includes('/')) {
    return {
      featureId: null,
      acId: acRef,
      key: acRef,
      primary: { file: null, role: null },
      allFiles: [],
      callGraph: [],
      warnings: [
        `AC reference "${acRef}" lacks a feature prefix. Pass "F-NNN/${acRef}" or set an active feature in SESSION.json.`,
      ],
      depthLimit: maxDepth,
    };
  }

  const [featureId, acId] = acRef.split('/');

  const tags = options.tags || scanDirectory(projectRoot);
  const acFileMap = buildAcFileMap(tags);
  const entry = acFileMap[acRef];

  if (!entry) {
    return {
      featureId,
      acId,
      key: acRef,
      primary: { file: null, role: null },
      allFiles: [],
      callGraph: [],
      warnings: [
        `No tags reference AC ${acRef}. Add @cap-todo(ac:${acRef}) at the implementation site.`,
      ],
      depthLimit: maxDepth,
    };
  }

  const result = {
    featureId,
    acId,
    key: acRef,
    primary: { file: entry.primary, role: entry.primarySource },
    allFiles: entry.files.slice(),
    callGraph: [],
    warnings: entry.warnings.slice(),
    depthLimit: maxDepth,
  };

  if (!entry.primary) {
    result.warnings.push('No primary file resolvable; cannot walk call graph.');
    return result;
  }

  const allowedFiles = options.restrictToAcFiles ? new Set(entry.files) : null;
  result.callGraph = walkCallGraph(entry.primary, projectRoot, { maxDepth, allowedFiles });

  return result;
}

// @cap-api formatTraceResult(traceResult) -- Render a TraceResult as human-readable markdown.
/**
 * @param {TraceResult} t
 * @returns {string}
 */
function formatTraceResult(t) {
  const lines = [];
  lines.push(`Trace: ${t.key}`);
  lines.push('');
  if (t.primary.file) {
    lines.push(`Primary: ${t.primary.file} (${t.primary.role})`);
  } else {
    lines.push('Primary: (none)');
  }
  lines.push('');

  if (t.callGraph.length === 0) {
    lines.push('Call graph: (no internal edges from primary)');
  } else {
    lines.push('Call graph:');
    // Group by `from` for a tree-ish view
    const byFrom = {};
    for (const edge of t.callGraph) {
      if (!byFrom[edge.from]) byFrom[edge.from] = [];
      byFrom[edge.from].push(edge);
    }
    // Print starting at primary and following BFS order of visited files.
    const printed = new Set();
    const order = [];
    const queue = [t.primary.file];
    while (queue.length) {
      const f = queue.shift();
      if (printed.has(f)) continue;
      printed.add(f);
      order.push(f);
      const out = byFrom[f] || [];
      for (const e of out) {
        if (!e.external) queue.push(e.to);
      }
    }
    for (const f of order) {
      lines.push(`  ${f}`);
      const out = byFrom[f] || [];
      for (const e of out) {
        const marker = e.external ? '(external)' : '';
        lines.push(`    ${e.type} ${e.to} [line ${e.line}] ${marker}`.trimEnd());
      }
    }
  }

  lines.push('');
  lines.push('All files contributing to AC:');
  if (t.allFiles.length === 0) {
    lines.push('  (none)');
  } else {
    for (const f of t.allFiles) {
      lines.push(`  - ${f}`);
    }
  }

  if (t.warnings.length > 0) {
    lines.push('');
    lines.push('Warnings:');
    for (const w of t.warnings) {
      lines.push(`  ! ${w}`);
    }
  }

  lines.push('');
  lines.push(`Depth limit: ${t.depthLimit}`);

  return lines.join('\n');
}

module.exports = {
  DEFAULT_MAX_DEPTH,
  CODE_EXTENSIONS,
  resolveImport,
  extractEdges,
  walkCallGraph,
  traceAc,
  formatTraceResult,
};
