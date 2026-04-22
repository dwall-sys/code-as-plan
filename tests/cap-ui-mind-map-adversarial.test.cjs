// @cap-feature(feature:F-066) Mind-Map Visualization — adversarial contract tests.
// @cap-decision Written after the baseline (tests/cap-ui-mind-map.test.cjs) is green. These tests
//   pin down adversarial contracts — determinism, zero-deps purity, edge-case silence, XSS escape
//   discipline, performance ceilings, and F-065 regression guards. They should all pass GREEN
//   against the current implementation; if any ever goes RED, the implementation drifted from
//   a documented contract and must be investigated rather than weakened here.
// @cap-decision node:test + node:assert only. No vitest. Zero external deps, consistent with
//   the F-065/F-066 test layer.

'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');

const ui = require('../cap/bin/lib/cap-ui.cjs');
const featureMapLib = require('../cap/bin/lib/cap-feature-map.cjs');

// --- Helpers ---------------------------------------------------------------

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
function rmTmp(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function makeRealisticProject() {
  const dir = mkTmp('cap-mm-adv-');
  const featureMap = {
    features: [
      { id: 'F-001', title: 'Tag Scanner', state: 'shipped', acs: [], files: [], dependencies: [], usesDesign: [], metadata: { group: 'cap:core' } },
      { id: 'F-065', title: 'CAP-UI Core', state: 'prototyped', acs: [], files: [], dependencies: ['F-001'], usesDesign: [], metadata: { group: 'cap:ui' } },
      { id: 'F-066', title: 'Mind-Map', state: 'planned', acs: [], files: [], dependencies: ['F-065', 'F-063'], usesDesign: ['DT-001', 'DC-001'], metadata: { group: 'cap:ui' } },
      { id: 'F-063', title: 'Design Traceability', state: 'shipped', acs: [], files: [], dependencies: [], usesDesign: ['DT-001'], metadata: { group: 'cap:design' } },
    ],
    lastScan: null,
  };
  featureMapLib.writeFeatureMap(dir, featureMap);
  fs.writeFileSync(path.join(dir, 'DESIGN.md'), '## Tokens\n- primary (id: DT-001)\n## Components\n### Button (id: DC-001)\n', 'utf8');
  fs.mkdirSync(path.join(dir, '.cap', 'memory'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.cap', 'SESSION.json'), JSON.stringify({
    version: '2.0.0', activeFeature: 'F-066', step: 'prototype', lastCommand: '/cap:prototype', metadata: {},
  }));
  return dir;
}

function graphOf(features, tokens = [], components = []) {
  return ui.buildGraphData({
    featureMap: { features },
    designTokens: tokens,
    designComponents: components,
  });
}

// --- AC-1..AC-2: graph derivation under adversarial input ------------------

describe('F-066 adversarial: buildGraphData edge cases', () => {
  it('silently drops self-references (F-A -> F-A) instead of emitting a loop edge', () => {
    const g = graphOf([
      { id: 'F-A', title: 'A', state: 'shipped', dependencies: ['F-A'], usesDesign: [], metadata: {} },
    ]);
    assert.strictEqual(g.nodes.length, 1, 'self-ref node must still render');
    assert.strictEqual(g.edges.length, 0, 'self-edges must be dropped');
  });

  it('renders circular deps (F-A <-> F-B) as two directed edges, not a loop or crash', () => {
    const g = graphOf([
      { id: 'F-A', title: 'A', state: 'shipped', dependencies: ['F-B'], usesDesign: [], metadata: {} },
      { id: 'F-B', title: 'B', state: 'shipped', dependencies: ['F-A'], usesDesign: [], metadata: {} },
    ]);
    assert.strictEqual(g.edges.length, 2, 'both directions of a cycle must be edges');
    const ab = g.edges.find(e => e.from === 'F-A' && e.to === 'F-B');
    const ba = g.edges.find(e => e.from === 'F-B' && e.to === 'F-A');
    assert.ok(ab && ba, 'both A->B and B->A must be emitted');
    // Force layout must not hang on cycles.
    const layouted = ui.runForceLayout(g.nodes, g.edges);
    assert.strictEqual(layouted.length, 2);
    assert.ok(layouted.every(n => Number.isFinite(n.x) && Number.isFinite(n.y)));
  });

  it('drops edges to missing features silently (no throw, no log spam)', () => {
    const g = graphOf([
      { id: 'F-A', title: 'A', state: 'shipped', dependencies: ['F-Z', 'F-999', 'F-NOT-HERE'], usesDesign: ['DT-ZZZ', 'DC-ZZZ'], metadata: {} },
    ]);
    assert.strictEqual(g.nodes.length, 1, 'only F-A exists');
    assert.strictEqual(g.edges.length, 0, 'no edges to missing endpoints');
  });

  it('tolerates null/undefined items in features array', () => {
    const g = ui.buildGraphData({
      featureMap: { features: [null, undefined, { id: 'F-001', title: 'A', state: 'shipped', dependencies: [], usesDesign: [], metadata: {} }] },
      designTokens: [],
      designComponents: [],
    });
    assert.strictEqual(g.nodes.length, 1, 'null/undefined items skipped');
  });

  it('tolerates features with missing id (skipped, no throw)', () => {
    const g = ui.buildGraphData({
      featureMap: { features: [{ title: 'noid', state: 'planned' }, { id: 'F-A', title: 'A', state: 'shipped', dependencies: [], usesDesign: [], metadata: {} }] },
      designTokens: [],
      designComponents: [],
    });
    assert.strictEqual(g.nodes.length, 1);
    assert.strictEqual(g.nodes[0].id, 'F-A');
  });

  it('tolerates features with non-array dependencies / usesDesign', () => {
    // buildGraphData uses `(f.dependencies || [])` — falsy values must not throw.
    const g = ui.buildGraphData({
      featureMap: { features: [{ id: 'F-A', title: 'A', state: 'shipped', dependencies: null, usesDesign: undefined, metadata: {} }] },
      designTokens: [],
      designComponents: [],
    });
    assert.strictEqual(g.nodes.length, 1);
    assert.strictEqual(g.edges.length, 0);
  });

  it('deduplicates token / component IDs even when listed twice in input', () => {
    const g = graphOf([], ['DT-001', 'DT-001', 'DT-002'], ['DC-001', 'DC-001']);
    const tokenNodes = g.nodes.filter(n => n.type === 'token');
    const compNodes = g.nodes.filter(n => n.type === 'component');
    assert.strictEqual(tokenNodes.length, 2, 'deduped tokens');
    assert.strictEqual(compNodes.length, 1, 'deduped components');
  });

  it('empty DESIGN (no tokens/components) yields feature-only graph', () => {
    const g = graphOf(
      [{ id: 'F-001', title: 'A', state: 'shipped', dependencies: [], usesDesign: [], metadata: {} }],
      [], [],
    );
    const types = new Set(g.nodes.map(n => n.type));
    assert.deepStrictEqual([...types], ['feature'], 'only feature nodes when no DT/DC present');
  });

  it('node output order is stable: features first, then sorted tokens, then sorted components', () => {
    const g = graphOf(
      [{ id: 'F-002', title: 'B', state: 'planned', dependencies: [], usesDesign: [], metadata: {} },
       { id: 'F-001', title: 'A', state: 'shipped', dependencies: [], usesDesign: [], metadata: {} }],
      ['DT-002', 'DT-001'],
      ['DC-002', 'DC-001'],
    );
    const ids = g.nodes.map(n => n.id);
    // Features preserve input order; tokens/components are sorted.
    assert.deepStrictEqual(ids, ['F-002', 'F-001', 'DT-001', 'DT-002', 'DC-001', 'DC-002']);
  });
});

// --- Determinism: byte-identical layout + HTML across repeated calls -------

describe('F-066 adversarial: layout determinism', () => {
  const features = [
    { id: 'F-001', title: 'A', state: 'shipped', dependencies: [], usesDesign: [], metadata: { group: 'cap:core' } },
    { id: 'F-002', title: 'B', state: 'shipped', dependencies: ['F-001'], usesDesign: [], metadata: { group: 'cap:ui' } },
    { id: 'F-003', title: 'C', state: 'shipped', dependencies: ['F-001'], usesDesign: [], metadata: { group: 'cap:ui' } },
    { id: 'F-004', title: 'D', state: 'planned', dependencies: ['F-002', 'F-003'], usesDesign: [], metadata: { group: 'cap:ui' } },
  ];

  it('runForceLayout yields byte-identical positions across 100 invocations', () => {
    const g = graphOf(features);
    const first = ui.runForceLayout(g.nodes, g.edges);
    const firstKey = JSON.stringify(first.map(n => [n.id, n.x, n.y]));
    for (let i = 0; i < 99; i++) {
      const again = ui.runForceLayout(g.nodes, g.edges);
      const againKey = JSON.stringify(again.map(n => [n.id, n.x, n.y]));
      if (againKey !== firstKey) {
        assert.fail(`layout drifted at iteration ${i + 2}:\n  first=${firstKey}\n  later=${againKey}`);
      }
    }
  });

  it('buildMindMapSection is byte-identical across 50 invocations on the same graph', () => {
    const g = graphOf(features);
    const first = ui.buildMindMapSection({ graphData: g });
    for (let i = 0; i < 49; i++) {
      const again = ui.buildMindMapSection({ graphData: g });
      if (again !== first) assert.fail(`section drifted at iteration ${i + 2}`);
    }
  });

  it('createSnapshot writes byte-identical HTML across two successive runs', () => {
    const dir = makeRealisticProject();
    try {
      ui.createSnapshot({ projectRoot: dir });
      const snapPath = path.join(dir, '.cap', 'ui', 'snapshot.html');
      const firstBytes = fs.readFileSync(snapPath);

      // Second run — generatedAt will differ, so we compare only the mind-map section bytes,
      // which depend solely on featureMap + designIds, not on timestamps.
      ui.createSnapshot({ projectRoot: dir });
      const secondBytes = fs.readFileSync(snapPath);

      function extractMindMapSection(buf) {
        const s = buf.toString('utf8');
        const start = s.indexOf('<section class="cap-section" id="mind-map"');
        const endMarker = '</section>';
        const end = s.indexOf(endMarker, start);
        assert.ok(start >= 0 && end > start, 'mind-map section must be extractable');
        return s.slice(start, end + endMarker.length);
      }

      const a = extractMindMapSection(firstBytes);
      const b = extractMindMapSection(secondBytes);
      assert.strictEqual(a, b, 'mind-map section must be deterministic across snapshot runs');
    } finally { rmTmp(dir); }
  });

  it('FNV-1a seed is deterministic: identical graph data produces same first node position', () => {
    // Two independent graph objects with equal content must yield identical layouts.
    const f1 = [
      { id: 'F-001', title: 'A', state: 'shipped', dependencies: [], usesDesign: [], metadata: {} },
      { id: 'F-002', title: 'B', state: 'shipped', dependencies: ['F-001'], usesDesign: [], metadata: {} },
    ];
    const f2 = [
      { id: 'F-001', title: 'A', state: 'shipped', dependencies: [], usesDesign: [], metadata: {} },
      { id: 'F-002', title: 'B', state: 'shipped', dependencies: ['F-001'], usesDesign: [], metadata: {} },
    ];
    const g1 = graphOf(f1);
    const g2 = graphOf(f2);
    const l1 = ui.runForceLayout(g1.nodes, g1.edges);
    const l2 = ui.runForceLayout(g2.nodes, g2.edges);
    assert.deepStrictEqual(
      l1.map(n => ({ id: n.id, x: n.x, y: n.y })),
      l2.map(n => ({ id: n.id, x: n.x, y: n.y })),
      'identical input content must yield identical layout'
    );
  });
});

// --- AC-3: zero-deps purity + SVG structure --------------------------------

describe('F-066 adversarial: zero-deps purity + SVG shape', () => {
  it('cap-ui.cjs source only requires node: builtins and relative cap-*.cjs modules', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'cap', 'bin', 'lib', 'cap-ui.cjs'), 'utf8');
    const requireRE = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
    const bad = [];
    let m;
    while ((m = requireRE.exec(src)) !== null) {
      const mod = m[1];
      const isNodeBuiltin = mod.startsWith('node:');
      const isRelative = mod.startsWith('./') || mod.startsWith('../');
      if (!isNodeBuiltin && !isRelative) bad.push(mod);
    }
    assert.deepStrictEqual(bad, [], `non-builtin require: ${bad.join(', ')}`);
  });

  it('buildMindMapJs contains NO fetch / XMLHttpRequest / WebSocket / EventSource / sendBeacon', () => {
    const js = ui.buildMindMapJs();
    const banned = ['fetch(', 'XMLHttpRequest', 'new WebSocket', 'navigator.sendBeacon', 'new EventSource'];
    for (const tok of banned) {
      assert.ok(!js.includes(tok), `mind-map JS must not contain ${tok}`);
    }
  });

  it('buildMindMapJs contains no external http(s) URLs', () => {
    const js = ui.buildMindMapJs();
    const hits = js.match(/https?:\/\/[^\s'"]+/g) || [];
    assert.deepStrictEqual(hits, [], `mind-map JS must have no external URLs; found: ${hits.join(', ')}`);
  });

  it('buildMindMapCss contains no @import and no url(http(s):...) references', () => {
    const css = ui.buildMindMapCss();
    assert.ok(!css.includes('@import'), 'no @import allowed');
    assert.ok(!/url\(\s*['"]?https?:/i.test(css), 'no url(http...) allowed');
  });

  it('renderMindMapSvg produces well-formed <svg>…</svg> with exactly one outer element', () => {
    const g = graphOf([
      { id: 'F-001', title: 'A', state: 'shipped', dependencies: [], usesDesign: [], metadata: {} },
      { id: 'F-002', title: 'B', state: 'shipped', dependencies: ['F-001'], usesDesign: [], metadata: {} },
    ]);
    const svg = ui.renderMindMapSvg(ui.runForceLayout(g.nodes, g.edges), g.edges);
    const opens = svg.match(/<svg\b/g) || [];
    const closes = svg.match(/<\/svg>/g) || [];
    assert.strictEqual(opens.length, 1, 'exactly one <svg> opening tag');
    assert.strictEqual(closes.length, 1, 'exactly one </svg> closing tag');
    assert.ok(/viewBox="0 0 800 600"/.test(svg), 'viewBox must be set to 800x600 default');
    assert.ok(/role="img"/.test(svg), 'role=img for accessibility');
    assert.ok(/aria-label="CAP Mind-Map/.test(svg), 'aria-label present');
  });

  it('SVG has matching <g class="edges"> and <g class="nodes"> sections in edge-first order', () => {
    const g = graphOf([
      { id: 'F-001', title: 'A', state: 'shipped', dependencies: [], usesDesign: [], metadata: {} },
      { id: 'F-002', title: 'B', state: 'shipped', dependencies: ['F-001'], usesDesign: [], metadata: {} },
    ]);
    const svg = ui.renderMindMapSvg(ui.runForceLayout(g.nodes, g.edges), g.edges);
    const edgesIdx = svg.indexOf('class="edges"');
    const nodesIdx = svg.indexOf('class="nodes"');
    assert.ok(edgesIdx > 0 && nodesIdx > 0, 'both groups present');
    assert.ok(edgesIdx < nodesIdx, 'edges must be z-ordered below nodes');
  });

  it('all edges reference only node IDs that exist in the rendered SVG', () => {
    const g = graphOf([
      { id: 'F-001', title: 'A', state: 'shipped', dependencies: [], usesDesign: [], metadata: {} },
      { id: 'F-002', title: 'B', state: 'shipped', dependencies: ['F-001'], usesDesign: [], metadata: {} },
    ]);
    const svg = ui.renderMindMapSvg(ui.runForceLayout(g.nodes, g.edges), g.edges);
    // Collect all data-id attributes.
    const nodeIds = [...svg.matchAll(/data-id="([^"]+)"/g)].map(m => m[1]);
    // Collect all data-from / data-to references.
    const fromIds = [...svg.matchAll(/data-from="([^"]+)"/g)].map(m => m[1]);
    const toIds = [...svg.matchAll(/data-to="([^"]+)"/g)].map(m => m[1]);
    for (const id of [...fromIds, ...toIds]) {
      assert.ok(nodeIds.includes(id), `edge references unknown node: ${id}`);
    }
  });

  it('empty SVG placeholder still has proper viewBox and aria-label (no broken placeholder)', () => {
    const svg = ui.renderMindMapSvg([], []);
    assert.ok(/viewBox="0 0 800 600"/.test(svg), 'placeholder has default viewBox');
    assert.ok(/aria-label=/.test(svg), 'placeholder has aria-label');
    assert.ok(/id="cap-mind-map"/.test(svg), 'placeholder has stable SVG id');
  });
});

// --- AC-4: interaction JS contract -----------------------------------------

describe('F-066 adversarial: interaction JS contract', () => {
  it('buildMindMapJs targets the correct SVG id (cap-mind-map) and bails out cleanly if missing', () => {
    const js = ui.buildMindMapJs();
    assert.ok(js.includes("getElementById('cap-mind-map')"), 'target SVG id');
    // Bail-out guard: the IIFE must early-return when the SVG is not present on the page.
    assert.ok(/if\s*\(\s*!\s*svg\s*\)\s*return/.test(js), 'must early-return when SVG missing');
  });

  it('wheel handler calls preventDefault and uses passive: false', () => {
    const js = ui.buildMindMapJs();
    assert.ok(/preventDefault/.test(js), 'wheel handler must preventDefault');
    assert.ok(/\{\s*passive:\s*false\s*\}/.test(js), 'wheel listener must be passive:false');
  });

  it('zoom is clamped to a finite range (0.25x..4x of baseW)', () => {
    const js = ui.buildMindMapJs();
    assert.ok(/baseW\s*\*\s*0\.25/.test(js), 'lower zoom clamp present');
    assert.ok(/baseW\s*\*\s*4/.test(js), 'upper zoom clamp present');
  });

  it('pan only starts when the mousedown target is NOT a node', () => {
    const js = ui.buildMindMapJs();
    assert.ok(/closest\(['"]g\.node['"]\)/.test(js), 'pan guard uses closest(g.node)');
  });

  it('filter logic uses the __ungrouped__ bucket for ungrouped nodes', () => {
    const js = ui.buildMindMapJs();
    assert.ok(js.includes('__ungrouped__'), 'ungrouped bucket handled');
  });

  it('click-to-focus clears previous focus before applying new focus (no stale state)', () => {
    const js = ui.buildMindMapJs();
    assert.ok(/function\s+clearFocus/.test(js), 'clearFocus helper exists');
    assert.ok(/clearFocus\(\)/.test(js), 'clearFocus invoked inside focusNode');
  });
});

// --- AC-5: share + serve parity --------------------------------------------

describe('F-066 adversarial: --serve and --share parity + live-server regression', () => {
  let dir;
  beforeEach(() => { dir = makeRealisticProject(); });
  afterEach(() => { rmTmp(dir); });

  it('snapshot and live renders embed the same mind-map SVG content for the same input', () => {
    const snap = ui.collectProjectSnapshot(dir);
    const live = ui.renderHtml({ snapshot: snap, options: { live: true } });
    const share = ui.renderHtml({ snapshot: snap, options: { live: false } });

    function mmSvg(html) {
      const start = html.indexOf('<svg class="mind-map"');
      const endMarker = '</svg>';
      const end = html.indexOf(endMarker, start);
      return html.slice(start, end + endMarker.length);
    }
    const liveSvg = mmSvg(live);
    const shareSvg = mmSvg(share);
    assert.ok(liveSvg.length > 0 && shareSvg.length > 0, 'both modes render the SVG');
    assert.strictEqual(liveSvg, shareSvg, 'mind-map SVG must be identical across --serve and --share');
  });

  it('live server responds 200 on GET / with mind-map section; 405 on POST / (F-065 regression)', async () => {
    const server = await ui.startServer({ projectRoot: dir, port: 0, watch: false });
    try {
      const getRes = await new Promise((resolve, reject) => {
        http.get(server.url + '/', (res) => {
          let b = '';
          res.on('data', c => b += c);
          res.on('end', () => resolve({ status: res.statusCode, body: b }));
          res.on('error', reject);
        });
      });
      assert.strictEqual(getRes.status, 200);
      assert.ok(getRes.body.includes('id="mind-map"'), 'live GET / must include mind-map section');
      assert.ok(getRes.body.includes('id="cap-mind-map"'), 'live GET / must include mind-map SVG');

      const postRes = await new Promise((resolve, reject) => {
        const req = http.request(server.url + '/', { method: 'POST' }, (res) => {
          let b = '';
          res.on('data', c => b += c);
          res.on('end', () => resolve({ status: res.statusCode, allow: res.headers.allow }));
          res.on('error', reject);
        });
        req.on('error', reject);
        req.end();
      });
      assert.strictEqual(postRes.status, 405, 'POST still rejected (F-065 AC-5 read-only regression)');
      assert.ok(/GET/.test(postRes.allow || ''), 'Allow header advertises GET');
    } finally {
      await server.stop();
    }
  });

  it('renderHtml for empty project still contains mind-map placeholder section', () => {
    const empty = mkTmp('cap-mm-empty-');
    try {
      fs.mkdirSync(path.join(empty, '.cap', 'memory'), { recursive: true });
      const snap = ui.collectProjectSnapshot(empty);
      const html = ui.renderHtml({ snapshot: snap });
      assert.ok(html.includes('id="mind-map"'), 'mind-map section present');
      assert.ok(html.includes('No features to visualize yet'), 'empty placeholder present');
      assert.ok(html.includes('0 nodes'), 'meta advertises 0 nodes');
    } finally { rmTmp(empty); }
  });
});

// --- XSS escape + class-attribute hygiene ----------------------------------

describe('F-066 adversarial: escape hygiene across all injection points', () => {
  it('hostile feature title is escaped in SVG <title> (no raw <script>)', () => {
    const g = graphOf([
      { id: 'F-001', title: '<img src=x onerror=alert(1)>', state: 'shipped', dependencies: [], usesDesign: [], metadata: {} },
    ]);
    const svg = ui.renderMindMapSvg(ui.runForceLayout(g.nodes, g.edges), g.edges);
    assert.ok(!svg.includes('<img src=x onerror=alert(1)>'), 'raw tag must not survive');
    assert.ok(svg.includes('&lt;img src=x onerror=alert(1)&gt;'), 'escaped form present');
  });

  it('hostile feature.state is sanitised to a safe CSS token (no attribute break-out)', () => {
    const g = graphOf([
      { id: 'F-001', title: 'A', state: '" onclick=alert(1) "', dependencies: [], usesDesign: [], metadata: {} },
    ]);
    const svg = ui.renderMindMapSvg(ui.runForceLayout(g.nodes, g.edges), g.edges);
    // state is emitted into class="node node-feature node-state-<state>", sanitised to [a-z0-9_-]
    // — hostile chars must not produce a raw onclick= handler in an unquoted attribute.
    const classMatch = svg.match(/class="node node-feature node-state-([^"]*)"/);
    assert.ok(classMatch, 'class attribute rendered');
    assert.ok(/^[a-z0-9_-]*$/.test(classMatch[1]), `state class token must match [a-z0-9_-]; got: ${classMatch[1]}`);
  });

  it('hostile metadata.group is escaped inside data-filter-group attribute', () => {
    const g = graphOf([
      { id: 'F-001', title: 'A', state: 'shipped', dependencies: [], usesDesign: [], metadata: { group: '" onclick=alert(1) "' } },
    ]);
    const html = ui.buildMindMapSection({ graphData: g });
    // The attribute value must use &quot; so the outer " boundary is intact.
    assert.ok(/data-filter-group="&quot;.*&quot;"/.test(html), 'group attribute escaped with &quot;');
    // There must be no raw unescaped " breaking the attribute.
    const attrStart = html.indexOf('data-filter-group="');
    const attrEnd = html.indexOf('"', attrStart + 'data-filter-group="'.length);
    const attrBody = html.slice(attrStart + 'data-filter-group="'.length, attrEnd);
    assert.ok(!attrBody.includes('"'), 'attribute body contains no raw quote');
  });

  it('hostile feature.id is escaped inside data-id attribute', () => {
    // buildGraphData trusts f.id but escapeHtml is applied at render time.
    const g = graphOf([
      { id: 'F-001" onclick=alert(1) x="', title: 'A', state: 'shipped', dependencies: [], usesDesign: [], metadata: {} },
    ]);
    const svg = ui.renderMindMapSvg(ui.runForceLayout(g.nodes, g.edges), g.edges);
    assert.ok(svg.includes('&quot;'), 'quote escaped to &quot;');
    // Must not contain a raw unescaped onclick attribute escaping the data-id boundary.
    assert.ok(!/data-id="[^"]*" onclick=alert/.test(svg), 'attribute break-out must not be possible');
  });
});

// --- Performance ceiling ---------------------------------------------------

describe('F-066 adversarial: performance ceiling', () => {
  it('layout of 200 nodes terminates in under 2 seconds (CAP-scale budget)', () => {
    const features = [];
    for (let i = 1; i <= 200; i++) {
      const id = 'F-' + String(i).padStart(3, '0');
      const dep = (i > 1 && i % 5 === 0) ? ['F-' + String(i - 1).padStart(3, '0')] : [];
      features.push({ id, title: 'F' + i, state: 'planned', dependencies: dep, usesDesign: [], metadata: {} });
    }
    const g = graphOf(features);
    const t0 = Date.now();
    const layout = ui.runForceLayout(g.nodes, g.edges);
    const elapsed = Date.now() - t0;
    assert.strictEqual(layout.length, 200);
    assert.ok(elapsed < 2000, `200-node layout must be < 2s (@cap-risk O(N²)); was ${elapsed}ms`);
    for (const n of layout) {
      assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y), `node ${n.id} has finite x/y`);
    }
  });

  it('buildGraphData over 1000 features terminates in well under 1 second', () => {
    const features = [];
    for (let i = 1; i <= 1000; i++) {
      const id = 'F-' + String(i).padStart(4, '0');
      features.push({ id, title: 'F' + i, state: 'planned', dependencies: [], usesDesign: [], metadata: {} });
    }
    const t0 = Date.now();
    const g = ui.buildGraphData({ featureMap: { features }, designTokens: [], designComponents: [] });
    const elapsed = Date.now() - t0;
    assert.strictEqual(g.nodes.length, 1000);
    assert.ok(elapsed < 1000, `1000-feature buildGraphData must be < 1s; was ${elapsed}ms`);
  });

  it('layout of 500 nodes still produces rounded, finite, in-range positions', () => {
    const features = [];
    for (let i = 1; i <= 500; i++) {
      features.push({ id: 'F-' + String(i).padStart(3, '0'), title: 'F' + i, state: 'planned', dependencies: [], usesDesign: [], metadata: {} });
    }
    const g = graphOf(features);
    const layout = ui.runForceLayout(g.nodes, g.edges);
    for (const n of layout) {
      assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y));
      assert.ok(n.x >= 0 && n.x <= 800, `${n.id} x in viewbox`);
      assert.ok(n.y >= 0 && n.y <= 600, `${n.id} y in viewbox`);
      // Rounded to 2 decimals.
      assert.ok(Math.abs(n.x * 100 - Math.round(n.x * 100)) < 1e-6, `${n.id} x rounded`);
      assert.ok(Math.abs(n.y * 100 - Math.round(n.y * 100)) < 1e-6, `${n.id} y rounded`);
    }
  });
});

// --- Regression: F-001 / F-019 / F-062..F-065 surfaces not broken -----------

describe('F-066 adversarial: regression guards against F-001/F-019/F-062..F-065', () => {
  it('cap-ui module still exports F-065 surface (startServer, renderHtml, createSnapshot, startFileWatcher, collectProjectSnapshot, escapeHtml)', () => {
    for (const name of ['startServer', 'renderHtml', 'createSnapshot', 'startFileWatcher', 'collectProjectSnapshot', 'escapeHtml']) {
      assert.strictEqual(typeof ui[name], 'function', `F-065 export ${name} must remain`);
    }
  });

  it('cap-ui module exposes new F-066 surface (buildGraphData, runForceLayout, renderMindMapSvg, buildMindMapSection, buildMindMapCss, buildMindMapJs)', () => {
    for (const name of ['buildGraphData', 'runForceLayout', 'renderMindMapSvg', 'buildMindMapSection', 'buildMindMapCss', 'buildMindMapJs']) {
      assert.strictEqual(typeof ui[name], 'function', `F-066 export ${name} must be present`);
    }
  });

  it('buildCss composes core + mind-map without leaking stylesheet globals from mind-map', () => {
    const core = ui.buildCoreCss();
    const mm = ui.buildMindMapCss();
    const combined = ui.buildCss();
    assert.ok(combined.includes(core), 'core CSS embedded verbatim');
    assert.ok(combined.includes(mm), 'mind-map CSS embedded verbatim');
    // Mind-map styles are scoped via svg.mind-map / #mind-map selectors — no bare body/html overrides.
    assert.ok(!/^\s*body\s*\{/m.test(mm), 'mind-map CSS must not override bare body selector');
    assert.ok(!/^\s*html\s*\{/m.test(mm), 'mind-map CSS must not override bare html selector');
  });

  it('buildClientJs live and snapshot modes stay compositional and independent', () => {
    const live = ui.buildClientJs({ live: true });
    const share = ui.buildClientJs({ live: false });
    // Live contains EventSource, snapshot does not.
    assert.ok(live.includes('EventSource'), 'live has SSE reconnect');
    assert.ok(!share.includes('EventSource'), 'snapshot has no SSE');
    // Both contain mind-map JS.
    assert.ok(live.includes("getElementById('cap-mind-map')"));
    assert.ok(share.includes("getElementById('cap-mind-map')"));
  });

  it('CAP tag type count (F-001) not regressed — cap-tag-scanner.cjs still lists 4 primary types', () => {
    const mod = require('../cap/bin/lib/cap-tag-scanner.cjs');
    assert.strictEqual(Array.isArray(mod.CAP_TAG_TYPES), true, 'CAP_TAG_TYPES exported');
    assert.strictEqual(mod.CAP_TAG_TYPES.length, 4, 'F-001 contract: exactly 4 primary tag types');
  });
});
