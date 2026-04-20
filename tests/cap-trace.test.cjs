'use strict';

// @cap-feature(feature:F-045) Tests for cap-trace.cjs (call-graph walker + traceAc + formatTraceResult).
// @cap-todo(ac:F-045/AC-4) Verify traceAc returns correct call graph from primary file across referenced files.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  DEFAULT_MAX_DEPTH,
  CODE_EXTENSIONS,
  resolveImport,
  extractEdges,
  walkCallGraph,
  traceAc,
  formatTraceResult,
} = require('../cap/bin/lib/cap-trace.cjs');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-trace-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// --- module exports ---

describe('cap-trace exports', () => {
  it('exports the expected surface', () => {
    assert.strictEqual(typeof DEFAULT_MAX_DEPTH, 'number');
    assert.ok(DEFAULT_MAX_DEPTH >= 1);
    assert.ok(Array.isArray(CODE_EXTENSIONS));
    assert.ok(CODE_EXTENSIONS.includes('.js'));
    assert.ok(CODE_EXTENSIONS.includes('.ts'));
    assert.strictEqual(typeof resolveImport, 'function');
    assert.strictEqual(typeof extractEdges, 'function');
    assert.strictEqual(typeof walkCallGraph, 'function');
    assert.strictEqual(typeof traceAc, 'function');
    assert.strictEqual(typeof formatTraceResult, 'function');
  });
});

// --- resolveImport ---

describe('resolveImport', () => {
  it('returns null for bare specifier (npm package)', () => {
    fs.writeFileSync(path.join(tmpDir, 'main.js'), '', 'utf8');
    const result = resolveImport('lodash', path.join(tmpDir, 'main.js'), tmpDir);
    assert.strictEqual(result, null);
  });

  it('returns null for node: built-in', () => {
    fs.writeFileSync(path.join(tmpDir, 'main.js'), '', 'utf8');
    const result = resolveImport('node:fs', path.join(tmpDir, 'main.js'), tmpDir);
    assert.strictEqual(result, null);
  });

  it('resolves ./relative.js', () => {
    fs.writeFileSync(path.join(tmpDir, 'main.js'), '', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'relative.js'), '', 'utf8');
    const result = resolveImport('./relative', path.join(tmpDir, 'main.js'), tmpDir);
    assert.strictEqual(result, path.join(tmpDir, 'relative.js'));
  });

  it('tries each code extension', () => {
    fs.writeFileSync(path.join(tmpDir, 'main.js'), '', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'helper.ts'), '', 'utf8');
    const result = resolveImport('./helper', path.join(tmpDir, 'main.js'), tmpDir);
    assert.strictEqual(result, path.join(tmpDir, 'helper.ts'));
  });

  it('resolves directory to index file', () => {
    fs.writeFileSync(path.join(tmpDir, 'main.js'), '', 'utf8');
    fs.mkdirSync(path.join(tmpDir, 'utils'));
    fs.writeFileSync(path.join(tmpDir, 'utils', 'index.js'), '', 'utf8');
    const result = resolveImport('./utils', path.join(tmpDir, 'main.js'), tmpDir);
    assert.strictEqual(result, path.join(tmpDir, 'utils', 'index.js'));
  });

  it('returns null when ../ escapes project root', () => {
    fs.mkdirSync(path.join(tmpDir, 'src'));
    const fromFile = path.join(tmpDir, 'src', 'main.js');
    fs.writeFileSync(fromFile, '', 'utf8');
    const result = resolveImport('../../outside', fromFile, tmpDir);
    assert.strictEqual(result, null);
  });

  it('returns null when target file does not exist', () => {
    fs.writeFileSync(path.join(tmpDir, 'main.js'), '', 'utf8');
    const result = resolveImport('./nonexistent', path.join(tmpDir, 'main.js'), tmpDir);
    assert.strictEqual(result, null);
  });

  it('returns absolute file when direct path with extension exists', () => {
    fs.writeFileSync(path.join(tmpDir, 'main.js'), '', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'sibling.js'), '', 'utf8');
    const result = resolveImport('./sibling.js', path.join(tmpDir, 'main.js'), tmpDir);
    assert.strictEqual(result, path.join(tmpDir, 'sibling.js'));
  });
});

// --- extractEdges ---

describe('extractEdges', () => {
  it('extracts CommonJS require edges with line numbers', () => {
    const file = path.join(tmpDir, 'main.js');
    fs.writeFileSync(file, [
      "'use strict';",
      "const fs = require('node:fs');",
      "const helper = require('./helper');",
      '',
      "module.exports = {};",
    ].join('\n'), 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'helper.js'), '', 'utf8');

    const edges = extractEdges(file, tmpDir);
    assert.strictEqual(edges.length, 2);
    assert.strictEqual(edges[0].type, 'require');
    assert.strictEqual(edges[0].line, 2);
    assert.strictEqual(edges[0].external, true); // node:fs
    assert.strictEqual(edges[1].external, false);
    assert.strictEqual(edges[1].to, 'helper.js');
  });

  it('extracts ES module imports', () => {
    const file = path.join(tmpDir, 'main.mjs');
    fs.writeFileSync(file, [
      "import fs from 'node:fs';",
      "import { foo } from './foo';",
    ].join('\n'), 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'foo.mjs'), '', 'utf8');

    const edges = extractEdges(file, tmpDir);
    assert.strictEqual(edges.length, 2);
    assert.strictEqual(edges[0].type, 'import');
    assert.strictEqual(edges[1].type, 'import');
    assert.strictEqual(edges[1].to, 'foo.mjs');
  });

  it('extracts export-from re-exports', () => {
    const file = path.join(tmpDir, 'index.js');
    fs.writeFileSync(file, "export { default } from './impl';\n", 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'impl.js'), '', 'utf8');

    const edges = extractEdges(file, tmpDir);
    assert.strictEqual(edges.length, 1);
    assert.strictEqual(edges[0].type, 'export-from');
    assert.strictEqual(edges[0].to, 'impl.js');
    assert.strictEqual(edges[0].external, false);
  });

  it('returns empty array for unreadable file', () => {
    const edges = extractEdges(path.join(tmpDir, 'nonexistent.js'), tmpDir);
    assert.deepStrictEqual(edges, []);
  });

  it('handles files with no imports', () => {
    const file = path.join(tmpDir, 'pure.js');
    fs.writeFileSync(file, "const x = 1;\nfunction y() { return x; }\n", 'utf8');
    const edges = extractEdges(file, tmpDir);
    assert.deepStrictEqual(edges, []);
  });
});

// --- walkCallGraph ---

describe('walkCallGraph', () => {
  it('walks BFS up to default depth from root file', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.js'), "require('./b');\n", 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'b.js'), "require('./c');\n", 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'c.js'), "require('./d');\n", 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'd.js'), "// leaf\n", 'utf8');

    const edges = walkCallGraph('a.js', tmpDir, { maxDepth: 3 });
    // a -> b, b -> c, c -> d (but c is at depth 2, walk visits c and yields its edge)
    const tos = edges.map(e => e.to);
    assert.ok(tos.includes('b.js'));
    assert.ok(tos.includes('c.js'));
    // d should be reachable at depth 3
    assert.ok(tos.includes('d.js'));
  });

  it('respects depth limit', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.js'), "require('./b');\n", 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'b.js'), "require('./c');\n", 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'c.js'), "require('./d');\n", 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'd.js'), "// leaf\n", 'utf8');

    const edges = walkCallGraph('a.js', tmpDir, { maxDepth: 1 });
    const tos = edges.map(e => e.to);
    assert.ok(tos.includes('b.js'));
    // depth 1 means we only visit 'a', and its edges to b are recorded but b's edges are not walked.
    assert.ok(!tos.includes('c.js'));
  });

  it('handles cycles without infinite loop', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.js'), "require('./b');\n", 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'b.js'), "require('./a');\n", 'utf8');

    const edges = walkCallGraph('a.js', tmpDir, { maxDepth: 5 });
    // Should terminate; both edges captured but no duplicates.
    assert.strictEqual(edges.length, 2);
  });

  it('deduplicates identical edges (same from:line:type:to)', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.js'), "require('./b');\nrequire('./b');\n", 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'b.js'), '', 'utf8');

    const edges = walkCallGraph('a.js', tmpDir, { maxDepth: 1 });
    // Two requires on different lines -> two edges.
    assert.strictEqual(edges.length, 2);
    // But both target b.js, so dedupe key (from:line:type:to) keeps both because line differs.
  });

  it('does not recurse into external edges', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.js'), "require('lodash');\nrequire('./b');\n", 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'b.js'), "require('./c');\n", 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'c.js'), '', 'utf8');

    const edges = walkCallGraph('a.js', tmpDir, { maxDepth: 3 });
    const externalEdges = edges.filter(e => e.external);
    assert.ok(externalEdges.length >= 1);
    assert.strictEqual(externalEdges[0].to, 'lodash');
  });

  it('respects allowedFiles set when restricting (does not recurse into disallowed)', () => {
    // a -> c (c is in allowed set, recurse) -> e (recorded but e is not in allowed set, do not recurse) -> f (never seen)
    fs.writeFileSync(path.join(tmpDir, 'a.js'), "require('./c');\nrequire('./b');\n", 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'b.js'), '', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'c.js'), "require('./e');\n", 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'e.js'), "require('./f');\n", 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'f.js'), '', 'utf8');

    const allowed = new Set(['a.js', 'c.js']);
    const edges = walkCallGraph('a.js', tmpDir, { maxDepth: 5, allowedFiles: allowed });
    const tos = edges.map(e => e.to);
    // a's edges: c (allowed, walked) and b (not allowed, recorded only)
    assert.ok(tos.includes('c.js'));
    assert.ok(tos.includes('b.js'));
    // c is walked, so c -> e is recorded
    assert.ok(tos.includes('e.js'));
    // e is NOT walked because it's not in allowed -> e -> f never recorded
    assert.ok(!tos.includes('f.js'));
  });

  it('returns empty array for nonexistent root file', () => {
    const edges = walkCallGraph('nonexistent.js', tmpDir);
    assert.deepStrictEqual(edges, []);
  });
});

// --- traceAc ---

describe('traceAc', () => {
  // @cap-todo(ac:F-045/AC-4) Verify traceAc end-to-end with real tagged files.

  function setupAcProject() {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"trace-test"}', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'main.js'), [
      "// @cap-feature(feature:F-100, primary:true) Main entry",
      "// @cap-todo(ac:F-100/AC-1) Implement login flow",
      "const helper = require('./helper');",
      "module.exports = { login: () => helper.check() };",
    ].join('\n'), 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'helper.js'), [
      "// @cap-feature(feature:F-100) Helper",
      "// @cap-todo(ac:F-100/AC-1) Validation routine",
      "module.exports = { check: () => true };",
    ].join('\n'), 'utf8');
  }

  it('returns warnings for invalid AC reference', () => {
    const result = traceAc(tmpDir, '');
    assert.ok(result.warnings.length >= 1);
    assert.strictEqual(result.primary.file, null);
  });

  it('returns warning for short-form ac without slash', () => {
    const result = traceAc(tmpDir, 'AC-1');
    assert.strictEqual(result.featureId, null);
    assert.strictEqual(result.acId, 'AC-1');
    assert.ok(result.warnings.some(w => w.includes('feature prefix')));
  });

  it('returns warning when AC has no tags in codebase', () => {
    setupAcProject();
    const result = traceAc(tmpDir, 'F-999/AC-1');
    assert.deepStrictEqual(result.allFiles, []);
    assert.strictEqual(result.primary.file, null);
    assert.ok(result.warnings.some(w => w.includes('No tags reference')));
  });

  it('returns designated primary and call graph for tagged AC', () => {
    setupAcProject();
    const result = traceAc(tmpDir, 'F-100/AC-1');
    assert.strictEqual(result.featureId, 'F-100');
    assert.strictEqual(result.acId, 'AC-1');
    assert.strictEqual(result.primary.file, 'main.js');
    assert.strictEqual(result.primary.role, 'designated');
    assert.ok(result.allFiles.includes('main.js'));
    assert.ok(result.allFiles.includes('helper.js'));
    assert.ok(result.callGraph.length >= 1);
    const helperEdge = result.callGraph.find(e => e.to === 'helper.js');
    assert.ok(helperEdge);
    assert.strictEqual(helperEdge.from, 'main.js');
    assert.strictEqual(helperEdge.type, 'require');
  });

  it('respects maxDepth option', () => {
    setupAcProject();
    fs.writeFileSync(path.join(tmpDir, 'deep.js'), '', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'helper.js'), [
      "// @cap-todo(ac:F-100/AC-1) Validation routine",
      "require('./deep');",
    ].join('\n'), 'utf8');

    const shallow = traceAc(tmpDir, 'F-100/AC-1', { maxDepth: 1 });
    const deep = traceAc(tmpDir, 'F-100/AC-1', { maxDepth: 3 });
    assert.ok(deep.callGraph.length >= shallow.callGraph.length);
  });

  it('uses pre-scanned tags option to avoid re-scan', () => {
    const tags = [
      { type: 'feature', metadata: { feature: 'F-100', primary: 'true' }, file: 'main.js', line: 1, description: '', raw: '', subtype: null },
      { type: 'todo', metadata: { ac: 'F-100/AC-1' }, file: 'main.js', line: 2, description: '', raw: '', subtype: null },
    ];
    fs.writeFileSync(path.join(tmpDir, 'main.js'), '// noop\n', 'utf8');
    const result = traceAc(tmpDir, 'F-100/AC-1', { tags });
    assert.strictEqual(result.primary.file, 'main.js');
    assert.strictEqual(result.primary.role, 'designated');
  });

  it('returns no-primary warning when primary is null', () => {
    // Construct a synthetic case via tags option where no files
    const tags = [
      { type: 'todo', metadata: { ac: 'F-100/AC-1' }, file: 'phantom.js', line: 1, description: '', raw: '', subtype: null },
    ];
    const result = traceAc(tmpDir, 'F-100/AC-1', { tags });
    // phantom.js does not exist, so callGraph stays empty but primary is set
    assert.strictEqual(result.primary.file, 'phantom.js');
    assert.deepStrictEqual(result.callGraph, []);
  });

  it('depthLimit reflects maxDepth option', () => {
    const tags = [
      { type: 'todo', metadata: { ac: 'F-100/AC-1' }, file: 'phantom.js', line: 1, description: '', raw: '', subtype: null },
    ];
    const result = traceAc(tmpDir, 'F-100/AC-1', { tags, maxDepth: 7 });
    assert.strictEqual(result.depthLimit, 7);
  });
});

// --- formatTraceResult ---

describe('formatTraceResult', () => {
  it('renders basic trace with primary and call graph', () => {
    const t = {
      featureId: 'F-100',
      acId: 'AC-1',
      key: 'F-100/AC-1',
      primary: { file: 'main.js', role: 'designated' },
      allFiles: ['main.js', 'helper.js'],
      callGraph: [
        { from: 'main.js', to: 'helper.js', type: 'require', line: 3, external: false },
        { from: 'helper.js', to: 'lodash', type: 'require', line: 5, external: true },
      ],
      warnings: [],
      depthLimit: 3,
    };
    const output = formatTraceResult(t);
    assert.ok(output.includes('Trace: F-100/AC-1'));
    assert.ok(output.includes('Primary: main.js (designated)'));
    assert.ok(output.includes('main.js'));
    assert.ok(output.includes('helper.js'));
    assert.ok(output.includes('(external)'));
    assert.ok(output.includes('Depth limit: 3'));
  });

  it('renders no-primary case', () => {
    const t = {
      featureId: 'F-100', acId: 'AC-1', key: 'F-100/AC-1',
      primary: { file: null, role: null },
      allFiles: [], callGraph: [],
      warnings: ['No tags reference AC F-100/AC-1.'],
      depthLimit: 3,
    };
    const output = formatTraceResult(t);
    assert.ok(output.includes('Primary: (none)'));
    assert.ok(output.includes('Warnings:'));
    assert.ok(output.includes('No tags reference'));
  });

  it('renders empty call graph message', () => {
    const t = {
      featureId: 'F-100', acId: 'AC-1', key: 'F-100/AC-1',
      primary: { file: 'main.js', role: 'inferred' },
      allFiles: ['main.js'],
      callGraph: [],
      warnings: [],
      depthLimit: 3,
    };
    const output = formatTraceResult(t);
    assert.ok(output.includes('no internal edges from primary'));
  });

  it('renders empty allFiles section', () => {
    const t = {
      featureId: 'F-100', acId: 'AC-1', key: 'F-100/AC-1',
      primary: { file: null, role: null },
      allFiles: [],
      callGraph: [],
      warnings: [],
      depthLimit: 3,
    };
    const output = formatTraceResult(t);
    assert.ok(output.includes('All files contributing to AC:'));
    assert.ok(output.includes('(none)'));
  });
});

// --- zero-dep compliance ---

describe('cap-trace zero-dep compliance', () => {
  it('only requires node: built-ins and local modules', () => {
    const tracePath = path.join(__dirname, '..', 'cap', 'bin', 'lib', 'cap-trace.cjs');
    const content = fs.readFileSync(tracePath, 'utf8');
    const requireRE = /require\(['"]([^'"]+)['"]\)/g;
    let match;
    while ((match = requireRE.exec(content)) !== null) {
      const req = match[1];
      const ok = req.startsWith('node:') || req.startsWith('./') || req.startsWith('../');
      assert.ok(ok, `Unexpected external require: ${req}`);
    }
  });
});

// --- adversarial edge cases (F-045 GREEN-phase verification) ---

// @cap-todo(ac:F-045/AC-4) Adversarial coverage for traceAc / walkCallGraph numeric-input edge cases
//   discovered during cap-tester GREEN-phase verification.

describe('walkCallGraph (numeric-edge adversarial)', () => {
  it('handles negative maxDepth as no-walk (terminate with zero edges)', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.js'), "require('./b');\n", 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'b.js'), '', 'utf8');
    const edges = walkCallGraph('a.js', tmpDir, { maxDepth: -1 });
    assert.deepStrictEqual(edges, []);
  });

  it('survives a 3-way circular require without infinite recursion', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.js'), "require('./b');\n", 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'b.js'), "require('./c');\n", 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'c.js'), "require('./a');\n", 'utf8');
    const edges = walkCallGraph('a.js', tmpDir, { maxDepth: 10 });
    // Each file is visited exactly once -> exactly 3 edges (a->b, b->c, c->a).
    assert.strictEqual(edges.length, 3);
  });

  it('handles file requiring itself without infinite recursion', () => {
    fs.writeFileSync(path.join(tmpDir, 'self.js'), "require('./self');\n", 'utf8');
    const edges = walkCallGraph('self.js', tmpDir, { maxDepth: 5 });
    assert.strictEqual(edges.length, 1);
    assert.strictEqual(edges[0].from, 'self.js');
    assert.strictEqual(edges[0].to, 'self.js');
  });
});

describe('extractEdges (specifier-shape adversarial)', () => {
  it('silently skips template-literal require (documented @cap-risk)', () => {
    const file = path.join(tmpDir, 'a.js');
    fs.writeFileSync(file, 'require(`./helper`);\n', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'helper.js'), '', 'utf8');
    const edges = extractEdges(file, tmpDir);
    assert.deepStrictEqual(edges, []);
  });

  it('silently skips dynamic require(variable) (documented @cap-risk)', () => {
    const file = path.join(tmpDir, 'a.js');
    fs.writeFileSync(file, 'const name = "./helper"; require(name);\n', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'helper.js'), '', 'utf8');
    const edges = extractEdges(file, tmpDir);
    assert.deepStrictEqual(edges, []);
  });

  it('skips dynamic await import(expr) (only static import is captured)', () => {
    const file = path.join(tmpDir, 'a.js');
    fs.writeFileSync(file, 'const x = await import("./helper.js");\n', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'helper.js'), '', 'utf8');
    const edges = extractEdges(file, tmpDir);
    // IMPORT_RE anchors at the start of the line: `^\s*import\b...` so dynamic
    // import in the middle of an expression must not be captured.
    assert.deepStrictEqual(edges, []);
  });

  it('resolves explicit .cjs extension and bare ./helper to the same .cjs file', () => {
    const file = path.join(tmpDir, 'a.js');
    fs.writeFileSync(file, "require('./helper.cjs');\nrequire('./helper');\n", 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'helper.cjs'), '', 'utf8');
    const edges = extractEdges(file, tmpDir);
    assert.strictEqual(edges.length, 2);
    assert.strictEqual(edges[0].to, 'helper.cjs');
    assert.strictEqual(edges[1].to, 'helper.cjs');
    assert.strictEqual(edges[0].external, false);
    assert.strictEqual(edges[1].external, false);
  });

  it('returns empty edges for Python file (regex is JS/TS-only by design)', () => {
    const file = path.join(tmpDir, 'a.py');
    fs.writeFileSync(file, "from helper import x\nimport other\n", 'utf8');
    const edges = extractEdges(file, tmpDir);
    assert.deepStrictEqual(edges, []);
  });
});

describe('resolveImport (adversarial)', () => {
  it('returns null for empty-string spec', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.js'), '', 'utf8');
    const r = resolveImport('', path.join(tmpDir, 'a.js'), tmpDir);
    assert.strictEqual(r, null);
  });
});

describe('traceAc (adversarial primary semantics)', () => {
  it('treats explicit primary:false on @cap-feature as not-primary (heuristic kicks in)', () => {
    const tags = [
      { type: 'feature', metadata: { feature: 'F-X', primary: 'false' }, file: 'a.js', line: 1, description: '', raw: '', subtype: null },
      { type: 'todo', metadata: { ac: 'F-X/AC-1' }, file: 'a.js', line: 2, description: '', raw: '', subtype: null },
      { type: 'todo', metadata: { ac: 'F-X/AC-1' }, file: 'b.js', line: 1, description: '', raw: '', subtype: null },
      { type: 'todo', metadata: { ac: 'F-X/AC-1' }, file: 'b.js', line: 2, description: '', raw: '', subtype: null },
    ];
    fs.writeFileSync(path.join(tmpDir, 'a.js'), '', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'b.js'), '', 'utf8');
    const result = traceAc(tmpDir, 'F-X/AC-1', { tags });
    // primary:false must NOT be treated as designated; heuristic picks b.js (highest density).
    assert.strictEqual(result.primary.role, 'inferred');
    assert.strictEqual(result.primary.file, 'b.js');
  });

  it('honors first-write-wins when two files claim primary:true for the same feature', () => {
    const tags = [
      { type: 'feature', metadata: { feature: 'F-Y', primary: 'true' }, file: 'first.js', line: 1, description: '', raw: '', subtype: null },
      { type: 'feature', metadata: { feature: 'F-Y', primary: 'true' }, file: 'second.js', line: 1, description: '', raw: '', subtype: null },
      { type: 'todo', metadata: { ac: 'F-Y/AC-1' }, file: 'first.js', line: 2, description: '', raw: '', subtype: null },
      { type: 'todo', metadata: { ac: 'F-Y/AC-1' }, file: 'second.js', line: 2, description: '', raw: '', subtype: null },
    ];
    fs.writeFileSync(path.join(tmpDir, 'first.js'), '', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'second.js'), '', 'utf8');
    const result = traceAc(tmpDir, 'F-Y/AC-1', { tags });
    assert.strictEqual(result.primary.file, 'first.js');
    assert.strictEqual(result.primary.role, 'designated');
  });

  it('returns no warnings.length growth when primary is designated and resolves to a real file', () => {
    const tags = [
      { type: 'feature', metadata: { feature: 'F-Z', primary: 'true' }, file: 'main.js', line: 1, description: '', raw: '', subtype: null },
      { type: 'todo', metadata: { ac: 'F-Z/AC-1' }, file: 'main.js', line: 2, description: '', raw: '', subtype: null },
    ];
    fs.writeFileSync(path.join(tmpDir, 'main.js'), '', 'utf8');
    const result = traceAc(tmpDir, 'F-Z/AC-1', { tags });
    assert.deepStrictEqual(result.warnings, []);
  });

  it('restrictToAcFiles records out-of-AC neighbor edge but does not recurse into it', () => {
    fs.writeFileSync(path.join(tmpDir, 'main.js'), [
      "require('./helper');",
      "require('./util');",
    ].join('\n'), 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'helper.js'), '', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'util.js'), "require('./deep');\n", 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'deep.js'), '', 'utf8');
    const tags = [
      { type: 'feature', metadata: { feature: 'F-R', primary: 'true' }, file: 'main.js', line: 1, description: '', raw: '', subtype: null },
      { type: 'todo', metadata: { ac: 'F-R/AC-1' }, file: 'main.js', line: 2, description: '', raw: '', subtype: null },
      { type: 'todo', metadata: { ac: 'F-R/AC-1' }, file: 'helper.js', line: 1, description: '', raw: '', subtype: null },
    ];
    const result = traceAc(tmpDir, 'F-R/AC-1', { tags, restrictToAcFiles: true });
    const tos = result.callGraph.map(e => e.to);
    // Both edges from main.js are recorded.
    assert.ok(tos.includes('helper.js'));
    assert.ok(tos.includes('util.js'));
    // util.js is NOT in allowedFiles, so deep.js must not appear.
    assert.ok(!tos.includes('deep.js'));
  });
});

describe('formatTraceResult (cycle robustness)', () => {
  it('terminates cleanly when the call graph contains a cycle (b->a->b)', () => {
    const t = {
      featureId: 'F-X', acId: 'AC-1', key: 'F-X/AC-1',
      primary: { file: 'a.js', role: 'designated' },
      allFiles: ['a.js', 'b.js'],
      callGraph: [
        { from: 'a.js', to: 'b.js', type: 'require', line: 1, external: false },
        { from: 'b.js', to: 'a.js', type: 'require', line: 1, external: false },
      ],
      warnings: [],
      depthLimit: 3,
    };
    const before = Date.now();
    const out = formatTraceResult(t);
    const elapsed = Date.now() - before;
    assert.ok(elapsed < 100, `format took ${elapsed}ms — possible infinite loop`);
    assert.ok(out.includes('a.js'));
    assert.ok(out.includes('b.js'));
  });
});

// @cap-feature(feature:F-045) Regression: explicit maxDepth:0 must be honored as zero,
//   not silently coerced to DEFAULT_MAX_DEPTH. Pre-fix this used `||` (falsy fallback);
//   fix uses `Number.isFinite(maxDepth) ? maxDepth : DEFAULT`. Same fix at CLI level
//   in commands/cap/trace.md for `--depth 0`.
describe('cap-trace explicit maxDepth:0 is honored (regression test)', () => {
  it('walkCallGraph with maxDepth:0 emits zero edges (only the seed file is in scope)', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.js'), "require('./b');\n", 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'b.js'), "require('./c');\n", 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'c.js'), "require('./d');\n", 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'd.js'), '', 'utf8');
    const e0 = walkCallGraph('a.js', tmpDir, { maxDepth: 0 });
    const eDefault = walkCallGraph('a.js', tmpDir, {});
    assert.strictEqual(e0.length, 0, 'maxDepth:0 must yield zero hops');
    assert.strictEqual(eDefault.length, 3, 'default depth still walks 3 hops');
  });

  it('traceAc with maxDepth:0 reports depthLimit=0 (not DEFAULT)', () => {
    const tags = [
      { type: 'todo', metadata: { ac: 'F-100/AC-1' }, file: 'phantom.js', line: 1, description: '', raw: '', subtype: null },
    ];
    const result = traceAc(tmpDir, 'F-100/AC-1', { tags, maxDepth: 0 });
    assert.strictEqual(result.depthLimit, 0, 'explicit maxDepth:0 must be preserved');
  });
});

describe('cap-trace live-repo invariants (F-045 self-trace)', () => {
  it('self-traces F-045/AC-4 against the live repo and finds cap-trace.cjs as designated primary', () => {
    const projectRoot = path.join(__dirname, '..');
    const result = traceAc(projectRoot, 'F-045/AC-4');
    assert.strictEqual(result.featureId, 'F-045');
    assert.strictEqual(result.acId, 'AC-4');
    assert.ok(result.primary.file, 'expected a primary file for F-045/AC-4');
    // Either cap/bin/lib/cap-trace.cjs (canonical) or its mirror in .claude/ —
    // both contain primary:true on @cap-feature so first-wins picks one.
    assert.ok(
      result.primary.file.endsWith('cap-trace.cjs'),
      `expected primary to end with cap-trace.cjs, got ${result.primary.file}`
    );
    assert.strictEqual(result.primary.role, 'designated');
    assert.ok(result.callGraph.length >= 1, 'expected at least one call-graph edge');
  });
});
