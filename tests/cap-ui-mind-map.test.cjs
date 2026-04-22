// @cap-feature(feature:F-066) Mind-Map Visualization — RED-GREEN tests covering AC-1..AC-5.
// @cap-decision Tests are pure + node:test + node:assert only. Zero external deps, consistent with F-065 test layer.
// @cap-decision Each AC has at least one dedicated describe block, plus helper describes for determinism and edge cases.

'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ui = require('../cap/bin/lib/cap-ui.cjs');
const featureMapLib = require('../cap/bin/lib/cap-feature-map.cjs');

// --- Helpers ---------------------------------------------------------------

function makeMindMapProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-mm-'));
  // Feature Map with deps + usesDesign entries so the graph has edges of both kinds.
  const featureMap = {
    features: [
      {
        id: 'F-001', title: 'Tag Scanner', state: 'shipped',
        acs: [{ id: 'AC-1', status: 'tested', description: 'Extract tags' }],
        files: [], dependencies: [], usesDesign: [], metadata: { group: 'cap:core' },
      },
      {
        id: 'F-065', title: 'CAP-UI Core', state: 'prototyped',
        acs: [{ id: 'AC-1', status: 'pending', description: 'Local server' }],
        files: [], dependencies: ['F-001'], usesDesign: [], metadata: { group: 'cap:ui' },
      },
      {
        id: 'F-066', title: 'Mind-Map', state: 'planned',
        acs: [{ id: 'AC-1', status: 'pending', description: 'Graph visualization' }],
        files: [], dependencies: ['F-065', 'F-063'], usesDesign: ['DT-001', 'DC-001'], metadata: { group: 'cap:ui' },
      },
      {
        id: 'F-063', title: 'Design Traceability', state: 'shipped',
        acs: [], files: [], dependencies: [], usesDesign: ['DT-001'], metadata: { group: 'cap:design' },
      },
    ],
    lastScan: null,
  };
  featureMapLib.writeFeatureMap(dir, featureMap);

  // Seed a DESIGN.md with inline DT/DC IDs so collectProjectSnapshot populates designIds.
  const designMd = [
    '# DESIGN.md',
    '',
    '## Tokens',
    '',
    '### Colors',
    '',
    '- primary: #b4553a (id: DT-001)',
    '- accent:  #d49a83 (id: DT-002)',
    '',
    '## Components',
    '',
    '### Button (id: DC-001)',
    '',
    '- variants: [primary, secondary]',
    '- states: [default, hover]',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'DESIGN.md'), designMd, 'utf8');

  // Seed minimal session + memory so renderHtml has a full snapshot to render.
  fs.mkdirSync(path.join(dir, '.cap', 'memory'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.cap', 'SESSION.json'), JSON.stringify({
    version: '2.0.0', activeFeature: 'F-066', step: 'prototype', lastCommand: '/cap:prototype', metadata: {},
  }));

  return dir;
}

function rmTmp(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

// --- AC-1: Mind-Map visualizes all @cap-* tag categories as graph -------------

describe('cap-ui F-066/AC-1: graph derivation covers all tag categories', () => {
  it('buildGraphData returns a {nodes, edges} shape', () => {
    const g = ui.buildGraphData({ featureMap: { features: [] }, designTokens: [], designComponents: [] });
    assert.ok(g && Array.isArray(g.nodes), 'nodes must be an array');
    assert.ok(Array.isArray(g.edges), 'edges must be an array');
  });

  it('includes feature, token, and component nodes from mixed input', () => {
    const g = ui.buildGraphData({
      featureMap: {
        features: [
          { id: 'F-001', title: 'Tag Scanner', state: 'shipped', dependencies: [], usesDesign: [], metadata: {} },
          { id: 'F-066', title: 'Mind-Map', state: 'planned', dependencies: ['F-001'], usesDesign: ['DT-001'], metadata: {} },
        ],
      },
      designTokens: ['DT-001', 'DT-002'],
      designComponents: ['DC-001'],
    });
    const types = new Set(g.nodes.map(n => n.type));
    assert.ok(types.has('feature'), 'must contain feature nodes');
    assert.ok(types.has('token'), 'must contain token nodes');
    assert.ok(types.has('component'), 'must contain component nodes');
  });

  it('handles empty graph gracefully (no features, no design IDs)', () => {
    const g = ui.buildGraphData({ featureMap: { features: [] }, designTokens: [], designComponents: [] });
    assert.deepStrictEqual(g, { nodes: [], edges: [] });
  });

  it('handles missing featureMap gracefully', () => {
    const g = ui.buildGraphData({});
    assert.deepStrictEqual(g, { nodes: [], edges: [] });
  });
});

// --- AC-2: Node types + edge kinds --------------------------------------------

describe('cap-ui F-066/AC-2: node + edge typing', () => {
  it('features classified as "feature", DT-* as "token", DC-* as "component"', () => {
    const g = ui.buildGraphData({
      featureMap: { features: [{ id: 'F-005', title: 'X', state: 'planned', dependencies: [], usesDesign: [], metadata: {} }] },
      designTokens: ['DT-001'],
      designComponents: ['DC-001'],
    });
    const byId = Object.fromEntries(g.nodes.map(n => [n.id, n]));
    assert.strictEqual(byId['F-005'].type, 'feature');
    assert.strictEqual(byId['DT-001'].type, 'token');
    assert.strictEqual(byId['DC-001'].type, 'component');
  });

  it('depends_on edges are emitted for feature.dependencies', () => {
    const g = ui.buildGraphData({
      featureMap: {
        features: [
          { id: 'F-001', title: 'A', state: 'shipped', dependencies: [], usesDesign: [], metadata: {} },
          { id: 'F-002', title: 'B', state: 'shipped', dependencies: ['F-001'], usesDesign: [], metadata: {} },
        ],
      },
      designTokens: [],
      designComponents: [],
    });
    const e = g.edges.find(x => x.from === 'F-002' && x.to === 'F-001');
    assert.ok(e, 'F-002 -> F-001 edge must exist');
    assert.strictEqual(e.kind, 'depends_on');
  });

  it('uses-design edges are emitted for feature.usesDesign', () => {
    const g = ui.buildGraphData({
      featureMap: {
        features: [
          { id: 'F-066', title: 'Map', state: 'planned', dependencies: [], usesDesign: ['DT-001', 'DC-001'], metadata: {} },
        ],
      },
      designTokens: ['DT-001'],
      designComponents: ['DC-001'],
    });
    const kinds = g.edges.filter(x => x.from === 'F-066').map(x => x.kind);
    assert.ok(kinds.includes('uses-design'), 'F-066 must have uses-design edges');
    assert.strictEqual(g.edges.filter(x => x.from === 'F-066').length, 2, 'two uses-design edges expected');
  });

  it('does not emit edges whose target node is missing from the graph', () => {
    const g = ui.buildGraphData({
      featureMap: {
        features: [
          { id: 'F-010', title: 'X', state: 'planned', dependencies: ['F-999'], usesDesign: ['DT-999'], metadata: {} },
        ],
      },
      designTokens: [],
      designComponents: [],
    });
    assert.strictEqual(g.edges.length, 0, 'edges to missing nodes must be filtered');
  });

  it('de-duplicates identical edges', () => {
    // Dependency listed twice in the feature map — only one edge should be emitted.
    const g = ui.buildGraphData({
      featureMap: {
        features: [
          { id: 'F-001', title: 'A', state: 'shipped', dependencies: [], usesDesign: [], metadata: {} },
          { id: 'F-002', title: 'B', state: 'shipped', dependencies: ['F-001', 'F-001'], usesDesign: [], metadata: {} },
        ],
      },
      designTokens: [],
      designComponents: [],
    });
    const matches = g.edges.filter(e => e.from === 'F-002' && e.to === 'F-001' && e.kind === 'depends_on');
    assert.strictEqual(matches.length, 1, 'duplicate edge must be collapsed');
  });
});

// --- AC-3: SVG + inline JS, no external libs ---------------------------------

describe('cap-ui F-066/AC-3: SVG rendering + zero runtime external libs', () => {
  let tmp;
  beforeEach(() => { tmp = makeMindMapProject(); });
  afterEach(() => { rmTmp(tmp); });

  it('renderMindMapSvg produces an <svg> element with node and edge groups', () => {
    const g = ui.buildGraphData({
      featureMap: {
        features: [
          { id: 'F-001', title: 'A', state: 'shipped', dependencies: [], usesDesign: [], metadata: {} },
          { id: 'F-002', title: 'B', state: 'shipped', dependencies: ['F-001'], usesDesign: [], metadata: {} },
        ],
      },
      designTokens: [],
      designComponents: [],
    });
    const layouted = ui.runForceLayout(g.nodes, g.edges);
    const svg = ui.renderMindMapSvg(layouted, g.edges);
    assert.ok(svg.startsWith('<svg'), 'must start with <svg>');
    assert.ok(svg.includes('class="edges"'), 'must include an edges group');
    assert.ok(svg.includes('class="nodes"'), 'must include a nodes group');
    assert.ok(svg.includes('<line'), 'must include line for edge');
    assert.ok(svg.includes('<circle'), 'must include circle for node');
  });

  it('renderMindMapSvg handles empty input gracefully with a placeholder', () => {
    const svg = ui.renderMindMapSvg([], []);
    assert.ok(svg.startsWith('<svg'), 'must still return an <svg>');
    assert.ok(svg.includes('No features'), 'must show an empty-state hint');
  });

  it('rendered HTML contains no <script src=...> references', () => {
    const snap = ui.collectProjectSnapshot(tmp);
    const html = ui.renderHtml({ snapshot: snap });
    assert.ok(!/<script\s+src\s*=/i.test(html), 'no external <script src> allowed');
  });

  it('rendered HTML contains no external http(s) URLs from CDNs', () => {
    const snap = ui.collectProjectSnapshot(tmp);
    const html = ui.renderHtml({ snapshot: snap });
    const hits = html.match(/https?:\/\/(?!127\.0\.0\.1|localhost)[^\s"'<>]+/g) || [];
    assert.deepStrictEqual(hits, [], `external URLs forbidden; found: ${hits.join(', ')}`);
  });

  it('cap-ui.cjs does not require d3, vis, cytoscape, or any external graph lib', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'cap', 'bin', 'lib', 'cap-ui.cjs'), 'utf8');
    const forbidden = ['d3', 'd3-force', 'vis', 'vis-network', 'cytoscape', 'sigma', 'ngraph'];
    const requireRE = /require\(['"]([^'"]+)['"]\)/g;
    let m;
    while ((m = requireRE.exec(src)) !== null) {
      const mod = m[1];
      assert.ok(!forbidden.includes(mod), `forbidden graph lib in require: ${mod}`);
    }
  });

  it('mind-map node classes encode type (feature/token/component)', () => {
    const g = ui.buildGraphData({
      featureMap: {
        features: [{ id: 'F-066', title: 'Map', state: 'planned', dependencies: [], usesDesign: ['DT-001'], metadata: {} }],
      },
      designTokens: ['DT-001'],
      designComponents: ['DC-001'],
    });
    const layouted = ui.runForceLayout(g.nodes, g.edges);
    const svg = ui.renderMindMapSvg(layouted, g.edges);
    assert.ok(svg.includes('node-feature'), 'feature node class');
    assert.ok(svg.includes('node-token'), 'token node class');
    assert.ok(svg.includes('node-component'), 'component node class');
  });

  it('edge classes encode kind (depends vs uses-design)', () => {
    const g = ui.buildGraphData({
      featureMap: {
        features: [
          { id: 'F-001', title: 'A', state: 'shipped', dependencies: [], usesDesign: [], metadata: {} },
          { id: 'F-066', title: 'B', state: 'planned', dependencies: ['F-001'], usesDesign: ['DT-001'], metadata: {} },
        ],
      },
      designTokens: ['DT-001'],
      designComponents: [],
    });
    const layouted = ui.runForceLayout(g.nodes, g.edges);
    const svg = ui.renderMindMapSvg(layouted, g.edges);
    assert.ok(svg.includes('edge-depends'), 'depends edge class');
    assert.ok(svg.includes('edge-uses-design'), 'uses-design edge class');
  });
});

// --- AC-4: Interaction (zoom, pan, filter, hover, click-to-focus) ------------

describe('cap-ui F-066/AC-4: interaction JS (zoom/pan/filter/hover/focus)', () => {
  it('buildMindMapJs returns IIFE with zoom, pan, filter, and focus handlers', () => {
    const js = ui.buildMindMapJs();
    assert.ok(js.length > 0, 'non-empty JS expected');
    // Zoom: wheel handler + viewBox manipulation
    assert.ok(/addEventListener\s*\(\s*['"]wheel['"]/.test(js), 'wheel handler for zoom');
    assert.ok(/setAttribute\s*\(\s*['"]viewBox['"]/.test(js), 'viewBox manipulation');
    // Pan: mousedown + mousemove
    assert.ok(/addEventListener\s*\(\s*['"]mousedown['"]/.test(js), 'mousedown handler for pan');
    assert.ok(/addEventListener\s*\(\s*['"]mousemove['"]/.test(js), 'mousemove handler for pan');
    // Filter: change handler on filter inputs
    assert.ok(/mm-filter-input/.test(js), 'filter input selector present');
    assert.ok(/addEventListener\s*\(\s*['"]change['"]/.test(js), 'change handler for filters');
    // Click-to-focus: click on svg + neighbour highlight
    assert.ok(/addEventListener\s*\(\s*['"]click['"]/.test(js), 'click handler for focus');
    assert.ok(/mm-focused|mm-neighbour|mm-dim/.test(js), 'focus CSS classes present');
  });

  it('filter checkboxes are emitted per distinct feature group', () => {
    const g = ui.buildGraphData({
      featureMap: {
        features: [
          { id: 'F-001', title: 'A', state: 'shipped', dependencies: [], usesDesign: [], metadata: { group: 'cap:core' } },
          { id: 'F-065', title: 'B', state: 'prototyped', dependencies: [], usesDesign: [], metadata: { group: 'cap:ui' } },
          { id: 'F-066', title: 'C', state: 'planned', dependencies: [], usesDesign: [], metadata: { group: 'cap:ui' } },
        ],
      },
      designTokens: [],
      designComponents: [],
    });
    const html = ui.buildMindMapSection({ graphData: g });
    assert.ok(html.includes('data-filter-group="cap:core"'), 'cap:core checkbox');
    assert.ok(html.includes('data-filter-group="cap:ui"'), 'cap:ui checkbox');
  });

  it('SVG nodes carry data-id and hover-enabling <title> elements', () => {
    const g = ui.buildGraphData({
      featureMap: {
        features: [
          { id: 'F-001', title: 'Tag Scanner', state: 'shipped', dependencies: [], usesDesign: [], metadata: {} },
        ],
      },
      designTokens: [],
      designComponents: [],
    });
    const layouted = ui.runForceLayout(g.nodes, g.edges);
    const svg = ui.renderMindMapSvg(layouted, g.edges);
    assert.ok(svg.includes('data-id="F-001"'), 'data-id attribute present');
    assert.ok(svg.includes('<title>F-001 — Tag Scanner</title>'), 'native <title> tooltip present');
  });
});

// --- AC-5: Mind-Map in both --serve and --share -------------------------------

describe('cap-ui F-066/AC-5: Mind-Map present in live and snapshot output', () => {
  let tmp;
  beforeEach(() => { tmp = makeMindMapProject(); });
  afterEach(() => { rmTmp(tmp); });

  it('live renderHtml output includes the Mind-Map section', () => {
    const snap = ui.collectProjectSnapshot(tmp);
    const html = ui.renderHtml({ snapshot: snap, options: { live: true } });
    assert.ok(html.includes('id="mind-map"'), 'mind-map section id');
    assert.ok(html.includes('id="cap-mind-map"'), 'mind-map SVG id');
    assert.ok(html.includes('Mind-Map'), 'Mind-Map heading');
  });

  it('static snapshot (--share) output includes the Mind-Map section', () => {
    const snap = ui.collectProjectSnapshot(tmp);
    const html = ui.renderHtml({ snapshot: snap, options: { live: false } });
    assert.ok(html.includes('id="mind-map"'), 'mind-map section id');
    assert.ok(html.includes('<svg'), 'svg tag present');
  });

  it('createSnapshot writes a file that contains the Mind-Map section', () => {
    ui.createSnapshot({ projectRoot: tmp });
    const html = fs.readFileSync(path.join(tmp, '.cap', 'ui', 'snapshot.html'), 'utf8');
    assert.ok(html.includes('id="mind-map"'), 'snapshot contains mind-map section');
    assert.ok(html.includes('id="cap-mind-map"'), 'snapshot contains mind-map svg');
  });

  it('renderHtml output contains both mind-map CSS and mind-map JS inline', () => {
    const snap = ui.collectProjectSnapshot(tmp);
    const html = ui.renderHtml({ snapshot: snap });
    // CSS signature from buildMindMapCss
    assert.ok(html.includes('svg.mind-map'), 'mind-map css present inline');
    // JS signature from buildMindMapJs
    assert.ok(html.includes("getElementById('cap-mind-map')"), 'mind-map js present inline');
  });
});

// --- Determinism + scale ------------------------------------------------------

describe('cap-ui F-066: determinism + scale', () => {
  it('runForceLayout is deterministic for identical input', () => {
    const g = ui.buildGraphData({
      featureMap: {
        features: [
          { id: 'F-001', title: 'A', state: 'shipped', dependencies: [], usesDesign: [], metadata: {} },
          { id: 'F-002', title: 'B', state: 'shipped', dependencies: ['F-001'], usesDesign: [], metadata: {} },
          { id: 'F-003', title: 'C', state: 'shipped', dependencies: ['F-001'], usesDesign: [], metadata: {} },
        ],
      },
      designTokens: [],
      designComponents: [],
    });
    const a = ui.runForceLayout(g.nodes, g.edges);
    const b = ui.runForceLayout(g.nodes, g.edges);
    assert.deepStrictEqual(
      a.map(n => ({ id: n.id, x: n.x, y: n.y })),
      b.map(n => ({ id: n.id, x: n.x, y: n.y })),
      'same input must yield byte-identical positions'
    );
  });

  it('buildMindMapSection output is byte-identical for identical graphs', () => {
    const g = {
      nodes: [
        { id: 'F-001', type: 'feature', label: 'F-001', group: 'cap:core', title: 'A', state: 'shipped' },
        { id: 'F-002', type: 'feature', label: 'F-002', group: 'cap:ui', title: 'B', state: 'planned' },
      ],
      edges: [{ from: 'F-002', to: 'F-001', kind: 'depends_on' }],
    };
    const a = ui.buildMindMapSection({ graphData: g });
    const b = ui.buildMindMapSection({ graphData: g });
    assert.strictEqual(a, b, 'buildMindMapSection must be deterministic');
  });

  it('handles 60+ nodes without error', () => {
    const features = [];
    for (let i = 1; i <= 60; i++) {
      const id = 'F-' + String(i).padStart(3, '0');
      const deps = i > 1 && i % 3 === 0 ? ['F-' + String(i - 1).padStart(3, '0')] : [];
      features.push({ id, title: 'Feature ' + i, state: 'planned', dependencies: deps, usesDesign: [], metadata: {} });
    }
    const g = ui.buildGraphData({ featureMap: { features }, designTokens: [], designComponents: [] });
    const layouted = ui.runForceLayout(g.nodes, g.edges);
    assert.strictEqual(layouted.length, 60);
    // All positions should be finite numbers inside (or near) the viewBox.
    for (const n of layouted) {
      assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y), `node ${n.id} has finite x/y`);
      assert.ok(n.x >= 0 && n.x <= 800, `node ${n.id} x within viewbox`);
      assert.ok(n.y >= 0 && n.y <= 600, `node ${n.id} y within viewbox`);
    }
  });

  it('positions are rounded to 2 decimals (snapshot stability)', () => {
    const g = ui.buildGraphData({
      featureMap: { features: [{ id: 'F-001', title: 'A', state: 'shipped', dependencies: [], usesDesign: [], metadata: {} }] },
      designTokens: [],
      designComponents: [],
    });
    const layouted = ui.runForceLayout(g.nodes, g.edges);
    for (const n of layouted) {
      // Multiplying by 100 should yield an integer (within floating-point tolerance).
      const scaled = n.x * 100;
      assert.ok(Math.abs(scaled - Math.round(scaled)) < 1e-6, 'x rounded to 2 decimals');
    }
  });
});

// --- XSS + escape guard for mind-map ------------------------------------------

describe('cap-ui F-066: escape hygiene', () => {
  it('escapes feature titles and IDs inside SVG <title>', () => {
    const g = ui.buildGraphData({
      featureMap: {
        features: [{ id: 'F-001', title: '<script>alert(1)</script>', state: 'shipped', dependencies: [], usesDesign: [], metadata: {} }],
      },
      designTokens: [],
      designComponents: [],
    });
    const layouted = ui.runForceLayout(g.nodes, g.edges);
    const svg = ui.renderMindMapSvg(layouted, g.edges);
    assert.ok(!svg.includes('<script>alert(1)</script>'), 'raw script must be escaped');
    assert.ok(svg.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'escaped form expected');
  });
});

// --- Composition: buildCss + buildClientJs still work ------------------------

describe('cap-ui F-066: buildCss + buildClientJs composition (hand-off from F-065)', () => {
  it('buildCss() contains both core CSS and mind-map CSS', () => {
    const css = ui.buildCss();
    // Core CSS signature
    assert.ok(css.includes('--mono:'), 'core CSS variables present');
    // Mind-map CSS signature
    assert.ok(css.includes('svg.mind-map'), 'mind-map CSS appended');
  });

  it('buildClientJs({ live: true }) contains both core JS and mind-map JS', () => {
    const js = ui.buildClientJs({ live: true });
    assert.ok(js.includes('EventSource'), 'core live JS present');
    assert.ok(js.includes("getElementById('cap-mind-map')"), 'mind-map JS appended');
  });

  it('buildClientJs({ live: false }) still contains mind-map JS', () => {
    const js = ui.buildClientJs({ live: false });
    assert.ok(!js.includes('EventSource'), 'no SSE client for static snapshot');
    assert.ok(js.includes("getElementById('cap-mind-map')"), 'mind-map JS present in snapshot');
  });
});
