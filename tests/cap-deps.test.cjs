'use strict';

// @cap-feature(feature:F-049) Tests for cap-deps.cjs — import parser, feature-id resolution, diff, Mermaid render.

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const deps = require('../cap/bin/lib/cap-deps.cjs');

// ---------------------------------------------------------------------------
// parseImports — regex-based extraction
// ---------------------------------------------------------------------------

describe('parseImports: syntax coverage', () => {
  it('extracts CJS require() calls', () => {
    const src = `
      const a = require('./foo');
      var b = require("./bar.cjs");
      require('./side-effect');
    `;
    const r = deps.parseImports(src);
    const sources = r.filter((x) => x.kind === 'cjs').map((x) => x.source);
    assert.deepStrictEqual(sources.sort(), ['./bar.cjs', './foo', './side-effect']);
  });

  it('extracts ESM import ... from', () => {
    const src = `
      import foo from './foo';
      import { bar } from '../bar';
      import * as ns from './ns';
      import './side-effect';
    `;
    const r = deps.parseImports(src);
    const sources = r.filter((x) => x.kind === 'esm').map((x) => x.source).sort();
    assert.deepStrictEqual(sources, ['../bar', './foo', './ns', './side-effect']);
  });

  it('extracts ESM re-exports', () => {
    const src = `
      export { default } from './a';
      export * from './b';
    `;
    const r = deps.parseImports(src);
    const sources = r.filter((x) => x.kind === 'reexport').map((x) => x.source).sort();
    assert.deepStrictEqual(sources, ['./a', './b']);
  });

  it('extracts dynamic import() calls with static strings', () => {
    const src = `
      const mod = await import('./lazy');
      import('./deferred').then(m => m.run());
    `;
    const r = deps.parseImports(src);
    const sources = r.filter((x) => x.kind === 'dynamic').map((x) => x.source).sort();
    assert.deepStrictEqual(sources, ['./deferred', './lazy']);
  });

  it('handles TypeScript import type', () => {
    // import type syntax is covered by the ESM_IMPORT_RE because the regex
    // ignores anything between "import" and "from"
    const src = `import type { Foo } from './types';`;
    const r = deps.parseImports(src);
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].source, './types');
    assert.strictEqual(r[0].kind, 'esm');
  });

  it('returns [] on empty / non-string input', () => {
    assert.deepStrictEqual(deps.parseImports(''), []);
    assert.deepStrictEqual(deps.parseImports(null), []);
    assert.deepStrictEqual(deps.parseImports(undefined), []);
    assert.deepStrictEqual(deps.parseImports(123), []);
  });

  it('does NOT capture template-literal or variable requires (documented limitation)', () => {
    const src = `
      const x = require(\`./dyn-\${name}\`);
      const mod = 'foo';
      const y = require(mod);
    `;
    const r = deps.parseImports(src);
    assert.strictEqual(r.length, 0, 'dynamic/computed requires must be ignored');
  });

  it('captures multiple occurrences on rerun (regex lastIndex reset)', () => {
    const src = `require('./a'); require('./b');`;
    const r1 = deps.parseImports(src);
    const r2 = deps.parseImports(src);
    assert.strictEqual(r1.length, 2);
    assert.strictEqual(r2.length, 2, 'second call must not miss matches due to regex state leak');
  });
});

// ---------------------------------------------------------------------------
// resolveImportToFile — Node-style relative path resolution
// ---------------------------------------------------------------------------

describe('resolveImportToFile: path resolution', () => {
  let tmp;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-deps-resolve-'));
    fs.mkdirSync(path.join(tmp, 'lib'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'lib', 'exact.cjs'), '// exact');
    fs.writeFileSync(path.join(tmp, 'lib', 'ext-sniff.js'), '// has .js suffix');
    fs.writeFileSync(path.join(tmp, 'pkg', 'index.cjs'), '// dir index');
  });

  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('resolves exact relative path', () => {
    const from = path.join(tmp, 'lib', 'caller.cjs');
    const resolved = deps.resolveImportToFile('./exact.cjs', from);
    assert.strictEqual(resolved, path.join(tmp, 'lib', 'exact.cjs'));
  });

  it('resolves by appending extension', () => {
    const from = path.join(tmp, 'lib', 'caller.cjs');
    const resolved = deps.resolveImportToFile('./ext-sniff', from);
    assert.strictEqual(resolved, path.join(tmp, 'lib', 'ext-sniff.js'));
  });

  it('resolves directory-index import', () => {
    const from = path.join(tmp, 'caller.cjs');
    const resolved = deps.resolveImportToFile('./pkg', from);
    assert.strictEqual(resolved, path.join(tmp, 'pkg', 'index.cjs'));
  });

  it('returns null for bare specifiers (node_modules / core)', () => {
    const from = path.join(tmp, 'caller.cjs');
    assert.strictEqual(deps.resolveImportToFile('node:fs', from), null);
    assert.strictEqual(deps.resolveImportToFile('react', from), null);
    assert.strictEqual(deps.resolveImportToFile('@scope/pkg', from), null);
  });

  it('returns null for missing relative paths', () => {
    const from = path.join(tmp, 'caller.cjs');
    assert.strictEqual(deps.resolveImportToFile('./does-not-exist', from), null);
  });

  it('returns null on null / empty / non-string input', () => {
    assert.strictEqual(deps.resolveImportToFile(null, '/tmp/x'), null);
    assert.strictEqual(deps.resolveImportToFile('', '/tmp/x'), null);
    assert.strictEqual(deps.resolveImportToFile(42, '/tmp/x'), null);
  });

  it('handles absolute imports', () => {
    const from = path.join(tmp, 'caller.cjs');
    const absTarget = path.join(tmp, 'lib', 'exact.cjs');
    assert.strictEqual(deps.resolveImportToFile(absTarget, from), absTarget);
  });
});

// ---------------------------------------------------------------------------
// buildFileToFeatureMap — tag-driven index
// ---------------------------------------------------------------------------

describe('buildFileToFeatureMap', () => {
  it('maps absolute files to their primary feature id', () => {
    const tags = [
      { type: 'feature', file: 'a/one.cjs', metadata: { feature: 'F-001' } },
      { type: 'feature', file: 'b/two.cjs', metadata: { feature: 'F-002' } },
      { type: 'todo', file: 'c/three.cjs', metadata: { ac: 'F-001/AC-1' } },
    ];
    const m = deps.buildFileToFeatureMap(tags, '/proj');
    assert.strictEqual(m.get('/proj/a/one.cjs'), 'F-001');
    assert.strictEqual(m.get('/proj/b/two.cjs'), 'F-002');
    assert.strictEqual(m.has('/proj/c/three.cjs'), false, 'non-@cap-feature tags do not create entries');
  });

  it('first-wins for multiple @cap-feature tags on one file', () => {
    const tags = [
      { type: 'feature', file: 'x.cjs', metadata: { feature: 'F-010' } },
      { type: 'feature', file: 'x.cjs', metadata: { feature: 'F-020' } },
    ];
    const m = deps.buildFileToFeatureMap(tags, '/proj');
    assert.strictEqual(m.get('/proj/x.cjs'), 'F-010');
  });

  it('handles absolute tag paths already', () => {
    const tags = [{ type: 'feature', file: '/abs/already/x.cjs', metadata: { feature: 'F-001' } }];
    const m = deps.buildFileToFeatureMap(tags, '/proj');
    assert.strictEqual(m.get('/abs/already/x.cjs'), 'F-001');
  });

  it('returns empty map for null or non-array input', () => {
    assert.strictEqual(deps.buildFileToFeatureMap(null, '/proj').size, 0);
    assert.strictEqual(deps.buildFileToFeatureMap('not-array', '/proj').size, 0);
  });
});

// ---------------------------------------------------------------------------
// inferFeatureDeps — full pipeline with injected readFile
// ---------------------------------------------------------------------------

describe('inferFeatureDeps (injected hooks)', () => {
  // Virtual-FS helper: maps from absolute path -> content, and resolves relative
  // imports by joining the caller's dirname with the source (ignoring extension
  // sniffing since the test fixtures use explicit extensions).
  function virtualHooks(files) {
    return {
      readFile: (p) => (p in files ? files[p] : ''),
      resolveImport: (source, fromFile) => {
        if (!source.startsWith('.')) return null;
        const joined = path.resolve(path.dirname(fromFile), source);
        if (joined in files) return joined;
        for (const ext of ['.cjs', '.js', '.mjs', '.ts']) {
          if ((joined + ext) in files) return joined + ext;
        }
        return null;
      },
    };
  }

  it('derives F-A -> F-B when A imports B', () => {
    const root = '/proj';
    const tags = [
      { type: 'feature', file: 'a.cjs', metadata: { feature: 'F-001' } },
      { type: 'feature', file: 'b.cjs', metadata: { feature: 'F-002' } },
    ];
    const files = {
      '/proj/a.cjs': `const b = require('./b.cjs');`,
      '/proj/b.cjs': `module.exports = {};`,
    };
    const result = deps.inferFeatureDeps(tags, root, virtualHooks(files));
    assert.deepStrictEqual(result.byFeature['F-001'], ['F-002']);
    assert.strictEqual((result.byFeature['F-002'] || []).length, 0, 'F-002 imports nothing tagged');
  });

  it('filters self-imports (A -> A is not a dependency)', () => {
    const root = '/proj';
    const tags = [
      { type: 'feature', file: 'a.cjs', metadata: { feature: 'F-001' } },
      { type: 'feature', file: 'a-helper.cjs', metadata: { feature: 'F-001' } },
    ];
    const files = {
      '/proj/a.cjs': `const h = require('./a-helper.cjs');`,
      '/proj/a-helper.cjs': `module.exports = {};`,
    };
    const result = deps.inferFeatureDeps(tags, root, virtualHooks(files));
    assert.strictEqual(result.byFeature['F-001'], undefined, 'self-import must not appear as dep');
  });

  it('deduplicates when same feature imported twice', () => {
    const root = '/proj';
    const tags = [
      { type: 'feature', file: 'a.cjs', metadata: { feature: 'F-001' } },
      { type: 'feature', file: 'b1.cjs', metadata: { feature: 'F-002' } },
      { type: 'feature', file: 'b2.cjs', metadata: { feature: 'F-002' } },
    ];
    const files = {
      '/proj/a.cjs': `require('./b1.cjs'); require('./b2.cjs');`,
      '/proj/b1.cjs': '',
      '/proj/b2.cjs': '',
    };
    const result = deps.inferFeatureDeps(tags, root, virtualHooks(files));
    assert.deepStrictEqual(result.byFeature['F-001'], ['F-002']);
  });

  it('records evidence with kind and source', () => {
    const root = '/proj';
    const tags = [
      { type: 'feature', file: 'a.ts', metadata: { feature: 'F-001' } },
      { type: 'feature', file: 'b.ts', metadata: { feature: 'F-002' } },
    ];
    const files = {
      '/proj/a.ts': `import { x } from './b';`,
      '/proj/b.ts': 'export const x = 1;',
    };
    const result = deps.inferFeatureDeps(tags, root, virtualHooks(files));
    assert.strictEqual(result.evidence['F-001'].length, 1);
    assert.strictEqual(result.evidence['F-001'][0].kind, 'esm');
    assert.strictEqual(result.evidence['F-001'][0].targetFeature, 'F-002');
  });

  it('swallows file-read errors (does not throw)', () => {
    const root = '/proj';
    const tags = [{ type: 'feature', file: 'a.cjs', metadata: { feature: 'F-001' } }];
    const result = deps.inferFeatureDeps(tags, root, {
      readFile: () => { throw new Error('boom'); },
      resolveImport: () => null,
    });
    assert.deepStrictEqual(result.byFeature, {});
  });

  it('sorts dependency lists alphabetically for deterministic diffs', () => {
    const root = '/proj';
    const tags = [
      { type: 'feature', file: 'a.cjs', metadata: { feature: 'F-001' } },
      { type: 'feature', file: 'm.cjs', metadata: { feature: 'F-050' } },
      { type: 'feature', file: 'e.cjs', metadata: { feature: 'F-010' } },
    ];
    const files = {
      '/proj/a.cjs': `require('./m.cjs'); require('./e.cjs');`,
      '/proj/m.cjs': '',
      '/proj/e.cjs': '',
    };
    const result = deps.inferFeatureDeps(tags, root, virtualHooks(files));
    assert.deepStrictEqual(result.byFeature['F-001'], ['F-010', 'F-050']);
  });
});

// ---------------------------------------------------------------------------
// diffDeclaredVsInferred
// ---------------------------------------------------------------------------

describe('diffDeclaredVsInferred', () => {
  function fm(features) { return { features }; }

  it('flags inferred deps missing from declared (needs adding)', () => {
    const rows = deps.diffDeclaredVsInferred(
      fm([{ id: 'F-001', dependencies: [] }]),
      { byFeature: { 'F-001': ['F-002'] } }
    );
    const f001 = rows.find((r) => r.feature === 'F-001');
    assert.deepStrictEqual(f001.missing, ['F-002']);
    assert.deepStrictEqual(f001.extraneous, []);
  });

  it('flags declared deps with no corresponding import (extraneous)', () => {
    const rows = deps.diffDeclaredVsInferred(
      fm([{ id: 'F-001', dependencies: ['F-002', 'F-003'] }]),
      { byFeature: { 'F-001': ['F-002'] } }
    );
    const f001 = rows.find((r) => r.feature === 'F-001');
    assert.deepStrictEqual(f001.missing, []);
    assert.deepStrictEqual(f001.extraneous, ['F-003']);
  });

  it('returns empty missing/extraneous when sets match', () => {
    const rows = deps.diffDeclaredVsInferred(
      fm([{ id: 'F-001', dependencies: ['F-002'] }]),
      { byFeature: { 'F-001': ['F-002'] } }
    );
    const f001 = rows.find((r) => r.feature === 'F-001');
    assert.deepStrictEqual(f001.missing, []);
    assert.deepStrictEqual(f001.extraneous, []);
  });

  it('includes features that exist only in inferred (not in FEATURE-MAP)', () => {
    const rows = deps.diffDeclaredVsInferred(
      fm([]),
      { byFeature: { 'F-999': ['F-001'] } }
    );
    const ghost = rows.find((r) => r.feature === 'F-999');
    assert.ok(ghost, 'orphan feature should appear in diff');
    assert.deepStrictEqual(ghost.missing, ['F-001']);
  });

  it('sorts rows by feature id', () => {
    const rows = deps.diffDeclaredVsInferred(
      fm([{ id: 'F-010', dependencies: [] }, { id: 'F-001', dependencies: [] }]),
      { byFeature: {} }
    );
    assert.deepStrictEqual(rows.map((r) => r.feature), ['F-001', 'F-010']);
  });
});

// ---------------------------------------------------------------------------
// formatDiffReport
// ---------------------------------------------------------------------------

describe('formatDiffReport', () => {
  it('returns consistency message when no drift', () => {
    const report = deps.formatDiffReport([
      { feature: 'F-001', declared: ['F-002'], inferred: ['F-002'], missing: [], extraneous: [] },
    ]);
    assert.ok(report.includes('consistent'));
  });

  it('shows missing and extraneous diffs', () => {
    const report = deps.formatDiffReport([
      { feature: 'F-010', declared: ['F-001'], inferred: ['F-002'], missing: ['F-002'], extraneous: ['F-001'] },
    ]);
    assert.ok(report.includes('F-010'));
    assert.ok(report.includes('+ add:     F-002'));
    assert.ok(report.includes('- remove?: F-001'));
  });
});

// ---------------------------------------------------------------------------
// renderMermaidGraph
// ---------------------------------------------------------------------------

describe('renderMermaidGraph', () => {
  function fm(features) { return { features }; }

  it('produces a fenced mermaid block with flowchart TD', () => {
    const out = deps.renderMermaidGraph(fm([]), { byFeature: {} });
    assert.ok(out.startsWith('```mermaid'));
    assert.ok(out.includes('flowchart TD'));
    assert.ok(out.endsWith('```'));
  });

  it('emits nodes for every feature', () => {
    const out = deps.renderMermaidGraph(
      fm([{ id: 'F-001', title: 'Tag Scanner', dependencies: [] }]),
      { byFeature: {} }
    );
    assert.ok(out.includes('F_001["F-001: Tag Scanner"]'));
  });

  it('draws solid arrow for declared edges', () => {
    const out = deps.renderMermaidGraph(
      fm([{ id: 'F-001', title: 'A', dependencies: ['F-002'] }, { id: 'F-002', title: 'B', dependencies: [] }]),
      { byFeature: {} },
      { source: 'declared' }
    );
    assert.ok(out.includes('F_001 --> F_002'));
  });

  it('draws dashed arrow for inferred-only edges', () => {
    const out = deps.renderMermaidGraph(
      fm([{ id: 'F-001', title: 'A', dependencies: [] }, { id: 'F-002', title: 'B', dependencies: [] }]),
      { byFeature: { 'F-001': ['F-002'] } },
      { source: 'inferred' }
    );
    assert.ok(out.includes('F_001 -.->|inferred| F_002'));
  });

  it('union mode prefers solid arrow when edge is both declared and inferred', () => {
    const out = deps.renderMermaidGraph(
      fm([{ id: 'F-001', title: 'A', dependencies: ['F-002'] }, { id: 'F-002', title: 'B', dependencies: [] }]),
      { byFeature: { 'F-001': ['F-002'] } }
      // default source: 'union'
    );
    assert.ok(out.includes('F_001 --> F_002'));
    assert.ok(!out.includes('-.->|inferred| F_002'), 'edge is declared — must not also appear as inferred-only');
  });

  it('truncates long labels to 40 chars', () => {
    const longTitle = 'A very very very very very very very long title here';
    const out = deps.renderMermaidGraph(fm([{ id: 'F-001', title: longTitle, dependencies: [] }]), { byFeature: {} });
    assert.ok(out.includes('…'), 'truncation marker expected');
  });

  it('escapes double-quotes in labels', () => {
    const out = deps.renderMermaidGraph(fm([{ id: 'F-001', title: 'with "quotes"', dependencies: [] }]), { byFeature: {} });
    assert.ok(out.includes('\\"quotes\\"'));
  });
});

// ---------------------------------------------------------------------------
// rewriteDependsOnLine — pure string manipulation
// ---------------------------------------------------------------------------

describe('rewriteDependsOnLine', () => {
  const fixture = [
    '# Feature Map',
    '',
    '### F-001: First [shipped]',
    '',
    '**Depends on:** F-000',
    '',
    '| AC | Status | Description |',
    '### F-002: Second [tested]',
    '',
    '| AC | Status | Description |',
    '### F-003: Third [planned]',
    '',
    '**Depends on:** F-001, F-002',
    '',
  ].join('\n');

  it('replaces an existing Depends on line', () => {
    const out = deps.rewriteDependsOnLine(fixture, 'F-001', '**Depends on:** F-000, F-010');
    assert.ok(out.includes('**Depends on:** F-000, F-010'));
    assert.ok(!out.match(/F-001.*\n\s*\n\*\*Depends on:\*\* F-000\n/s));
  });

  it('inserts a Depends on line when none exists', () => {
    const out = deps.rewriteDependsOnLine(fixture, 'F-002', '**Depends on:** F-001');
    // Line must appear between F-002 header and its AC table
    assert.ok(/F-002: Second.*\n\n\*\*Depends on:\*\* F-001\n/s.test(out));
  });

  it('removes the line when newLine is empty', () => {
    const out = deps.rewriteDependsOnLine(fixture, 'F-003', '');
    assert.ok(!out.includes('**Depends on:** F-001, F-002'));
  });

  it('returns unchanged when feature not found', () => {
    const out = deps.rewriteDependsOnLine(fixture, 'F-999', '**Depends on:** F-1');
    assert.strictEqual(out, fixture);
  });

  it('does not leak into adjacent feature blocks', () => {
    const out = deps.rewriteDependsOnLine(fixture, 'F-001', '**Depends on:** F-000, F-010');
    // F-003's existing line must still be intact
    assert.ok(out.includes('**Depends on:** F-001, F-002'));
  });
});

// ---------------------------------------------------------------------------
// loadDepsConfig
// ---------------------------------------------------------------------------

describe('loadDepsConfig', () => {
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-deps-cfg-'));
    fs.mkdirSync(path.join(tmp, '.cap'));
  });

  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('returns defaults when config file is absent', () => {
    const cfg = deps.loadDepsConfig(tmp);
    assert.strictEqual(cfg.enabled, false);
    assert.strictEqual(cfg.autoFix, false);
  });

  it('respects autoDepsInference.enabled=true', () => {
    fs.writeFileSync(
      path.join(tmp, '.cap', 'config.json'),
      JSON.stringify({ autoDepsInference: { enabled: true } })
    );
    const cfg = deps.loadDepsConfig(tmp);
    assert.strictEqual(cfg.enabled, true);
  });

  it('merges autoFix flag', () => {
    fs.writeFileSync(
      path.join(tmp, '.cap', 'config.json'),
      JSON.stringify({ autoDepsInference: { enabled: true, autoFix: true } })
    );
    const cfg = deps.loadDepsConfig(tmp);
    assert.strictEqual(cfg.autoFix, true);
  });

  it('ignores malformed config file and returns defaults', () => {
    fs.writeFileSync(path.join(tmp, '.cap', 'config.json'), 'not json {');
    const cfg = deps.loadDepsConfig(tmp);
    assert.strictEqual(cfg.enabled, false);
  });

  it('ignores non-object autoDepsInference section', () => {
    fs.writeFileSync(
      path.join(tmp, '.cap', 'config.json'),
      JSON.stringify({ autoDepsInference: 'not-an-object' })
    );
    const cfg = deps.loadDepsConfig(tmp);
    assert.strictEqual(cfg.enabled, false);
  });
});

// ---------------------------------------------------------------------------
// applyInferredDeps — integration with temp FEATURE-MAP.md
// ---------------------------------------------------------------------------

describe('applyInferredDeps', () => {
  let tmp;
  let featureMapPath;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-deps-apply-'));
    featureMapPath = path.join(tmp, 'FEATURE-MAP.md');
    fs.writeFileSync(featureMapPath, [
      '# Feature Map',
      '',
      '### F-001: A [shipped]',
      '',
      '| AC | Status | Description |',
      '### F-002: B [shipped]',
      '',
      '**Depends on:** F-001, F-999',
      '',
      '| AC | Status | Description |',
      '',
    ].join('\n'));
  });

  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('adds missing deps to a feature that has no Depends on line', () => {
    const diffRows = [
      { feature: 'F-001', declared: [], inferred: ['F-002'], missing: ['F-002'], extraneous: [] },
    ];
    const res = deps.applyInferredDeps(tmp, diffRows, { featureMapPath });
    assert.deepStrictEqual(res.updated, ['F-001']);
    const written = fs.readFileSync(featureMapPath, 'utf8');
    assert.ok(written.includes('### F-001: A [shipped]\n\n**Depends on:** F-002\n'));
  });

  it('keeps extraneous by default (only adds missing)', () => {
    const diffRows = [
      { feature: 'F-002', declared: ['F-001', 'F-999'], inferred: ['F-001'], missing: [], extraneous: ['F-999'] },
    ];
    const res = deps.applyInferredDeps(tmp, diffRows, { featureMapPath });
    assert.deepStrictEqual(res.unchanged, ['F-002']); // no missing, no removal
    const written = fs.readFileSync(featureMapPath, 'utf8');
    assert.ok(written.includes('**Depends on:** F-001, F-999'), 'extraneous remains');
  });

  it('removes extraneous when removeExtraneous=true', () => {
    const diffRows = [
      { feature: 'F-002', declared: ['F-001', 'F-999'], inferred: ['F-001'], missing: [], extraneous: ['F-999'] },
    ];
    const res = deps.applyInferredDeps(tmp, diffRows, { featureMapPath, removeExtraneous: true });
    assert.deepStrictEqual(res.updated, ['F-002']);
    const written = fs.readFileSync(featureMapPath, 'utf8');
    assert.ok(written.includes('**Depends on:** F-001'));
    assert.ok(!written.includes('F-999'));
  });

  it('does not write when diff is empty', () => {
    const before = fs.readFileSync(featureMapPath, 'utf8');
    const res = deps.applyInferredDeps(tmp, [
      { feature: 'F-001', declared: [], inferred: [], missing: [], extraneous: [] },
    ], { featureMapPath });
    assert.deepStrictEqual(res.updated, []);
    const after = fs.readFileSync(featureMapPath, 'utf8');
    assert.strictEqual(before, after, 'file must not be touched when nothing changes');
  });
});

// ---------------------------------------------------------------------------
// Integration smoke test — run the full pipeline on the actual CAP repo
// ---------------------------------------------------------------------------

describe('integration: real repo scan', () => {
  it('inferFeatureDeps terminates and returns a plausible F-049 dep set', () => {
    const scanner = require('../cap/bin/lib/cap-tag-scanner.cjs');
    const fm = require('../cap/bin/lib/cap-feature-map.cjs');

    const root = path.resolve(__dirname, '..');
    const tags = scanner.scanDirectory(root);
    const featureMap = fm.readFeatureMap(root);
    const inferred = deps.inferFeatureDeps(tags, root);
    const diff = deps.diffDeclaredVsInferred(featureMap, inferred);

    assert.ok(Array.isArray(diff));
    assert.ok(diff.length > 0, 'should produce at least one diff row');
    // Smoke: every row has the required fields
    for (const r of diff) {
      assert.ok(typeof r.feature === 'string' && /^F-\d{3}/.test(r.feature));
      assert.ok(Array.isArray(r.declared));
      assert.ok(Array.isArray(r.inferred));
      assert.ok(Array.isArray(r.missing));
      assert.ok(Array.isArray(r.extraneous));
    }
  });
});
